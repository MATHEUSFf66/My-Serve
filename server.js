const express = require("express");
const WebSocket = require("ws");
const { v4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 9090;
const server = app.listen(PORT, () => {
    console.log("Server listening on port: " + PORT);
});

const wss = new WebSocket.Server({ server });

// Estruturas para gerenciamento de salas e jogadores
const rooms = {};  // { roomCode: { players: Map<uuid, ws> } }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Adiciona jogador a uma sala
function addPlayerToRoom(roomCode, uuid, ws) {
    if (!rooms[roomCode]) rooms[roomCode] = { players: new Map() };
    rooms[roomCode].players.set(uuid, ws);
}

// Remove jogador de uma sala
function removePlayerFromRoom(roomCode, uuid) {
    if (rooms[roomCode]) {
        rooms[roomCode].players.delete(uuid);
        if (rooms[roomCode].players.size === 0) delete rooms[roomCode];
    }
}

wss.on("connection", (socket) => {
    const uuid = v4();
    let currentRoom = null;

    console.log(`Cliente conectado: ${uuid}`);

    // Envia UUID ao cliente
    socket.send(JSON.stringify({
        cmd: "joined_server",
        content: { msg: "Bem-vindo ao servidor!", uuid }
    }));

    socket.on("message", (message) => {
        let data;
        try { data = JSON.parse(message.toString()); } 
        catch (err) { console.error("Erro parse JSON:", err); return; }

        const cmd = data.cmd;
        const content = data.content || {};

        switch (cmd) {
            case "create_room": {
                const roomCode = generateRoomCode();
                currentRoom = roomCode;
                addPlayerToRoom(roomCode, uuid, socket);

                // Notifica o criador da sala
                socket.send(JSON.stringify({
                    cmd: "room_created",
                    content: { code: roomCode }
                }));

                // Spawna jogador local
                socket.send(JSON.stringify({
                    cmd: "spawn_local_player",
                    content: { player: { uuid, x:0, y:0 } }
                }));

                console.log(`Sala criada: ${roomCode} por ${uuid}`);
                break;
            }

            case "join_room": {
                const roomCode = content.code;
                if (!rooms[roomCode]) {
                    socket.send(JSON.stringify({
                        cmd: "error",
                        content: { msg: "Sala não encontrada!" }
                    }));
                    break;
                }

                currentRoom = roomCode;
                addPlayerToRoom(roomCode, uuid, socket);

                // Confirma entrada
                socket.send(JSON.stringify({
                    cmd: "room_joined",
                    content: { code: roomCode }
                }));

                // Spawna jogador local
                socket.send(JSON.stringify({
                    cmd: "spawn_local_player",
                    content: { player: { uuid, x:0, y:0 } }
                }));

                // Spawna novos jogadores para os outros na sala
                rooms[roomCode].players.forEach((clientWs, clientUuid) => {
                    if (clientUuid !== uuid && clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            cmd: "spawn_new_player",
                            content: { player: { uuid, x:0, y:0 } }
                        }));

                        // Também envia os jogadores existentes para o novo
                        socket.send(JSON.stringify({
                            cmd: "spawn_new_player",
                            content: { player: { uuid: clientUuid, x:0, y:0 } }
                        }));
                    }
                }));

                console.log(`Cliente ${uuid} entrou na sala ${roomCode}`);
                break;
            }

            case "position": {
                if (!currentRoom) break;
                const x = content.x || 0;
                const y = content.y || 0;
                rooms[currentRoom].players.forEach((clientWs, clientUuid) => {
                    if (clientUuid !== uuid && clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            cmd: "update_position",
                            content: { uuid, x, y }
                        }));
                    }
                });
                break;
            }

            case "chat": {
                if (!currentRoom) break;
                const msg = content.msg || "";
                rooms[currentRoom].players.forEach((clientWs) => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            cmd: "new_chat_message",
                            content: { msg }
                        }));
                    }
                });
                break;
            }
        }
    });

    socket.on("close", () => {
        console.log(`Cliente ${uuid} desconectou`);
        if (currentRoom) {
            rooms[currentRoom]?.players.forEach((clientWs, clientUuid) => {
                if (clientUuid !== uuid && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        cmd: "player_disconnected",
                        content: { uuid }
                    }));
                }
            });
            removePlayerFromRoom(currentRoom, uuid);
        }
    });
});
