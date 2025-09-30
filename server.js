const express = require("express");
const WebSocket = require("ws");
const { v4 } = require("uuid");
const playerlist = require("./playerlist.js"); // Sua lista de jogadores

const app = express();

// --- Rota HTTP mínima para Railway ---
app.get("/", (req, res) => {
    res.send("Servidor WebSocket ativo! Conecte via Godot WSS.");
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log("Server listening on port:", PORT);
});

// --- WebSocket Server ---
const wss = new WebSocket.Server({ server });

// --- Salas de jogo ---
const rooms = {}; // { roomCode: [ws, ws, ...] }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on("connection", async (socket) => {
    const uuid = v4();
    await playerlist.add(uuid);
    const newPlayer = await playerlist.get(uuid);

    // Enviar UUID ao cliente
    socket.send(JSON.stringify({
        cmd: "joined_server",
        content: { msg: "Bem-vindo ao servidor!", uuid }
    }));

    // Enviar jogador local
    socket.send(JSON.stringify({
        cmd: "spawn_local_player",
        content: { msg: "Spawning local (you) player!", player: newPlayer }
    }));

    // Enviar todos os outros jogadores ao novo cliente
    socket.send(JSON.stringify({
        cmd: "spawn_network_players",
        content: {
            msg: "Spawning network players!",
            players: await playerlist.getAll()
        }
    }));

    // --- Recebimento de mensagens ---
    socket.on("message", async (message) => {
        let data;
        try {
            data = JSON.parse(message.toString());
        } catch (err) {
            console.error("Erro ao fazer parse do JSON:", err);
            return;
        }

        switch (data.cmd) {
            // === Criação de sala ===
            case "create_room": {
                const roomCode = generateRoomCode();
                rooms[roomCode] = [socket];

                socket.send(JSON.stringify({
                    cmd: "room_created",
                    content: { code: roomCode }
                }));
                console.log(`Sala criada: ${roomCode}`);
                break;
            }

            // === Entrada em sala ===
            case "join_room": {
                const roomCode = data.content.code;
                if (!rooms[roomCode]) {
                    socket.send(JSON.stringify({
                        cmd: "server_error",
                        content: { msg: "Sala não encontrada!" }
                    }));
                    return;
                }

                rooms[roomCode].push(socket);

                // Avisar todos na sala que o jogador entrou
                rooms[roomCode].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            cmd: "room_joined",
                            content: { code: roomCode }
                        }));
                    }
                });

                console.log(`Jogador ${uuid} entrou na sala ${roomCode}`);

                // Se a sala tiver 2 jogadores, inicia partida
                if (rooms[roomCode].length >= 2) {
                    rooms[roomCode].forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ cmd: "start_game" }));
                        }
                    });
                }
                break;
            }

            // === Atualização de posição ===
            case "position": {
                playerlist.update(uuid, data.content.x, data.content.y);
                const update = {
                    cmd: "update_position",
                    content: { uuid, x: data.content.x, y: data.content.y }
                };

                wss.clients.forEach(client => {
                    if (client !== socket && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(update));
                    }
                });
                break;
            }

            // === Chat ===
            case "chat": {
                const chat = {
                    cmd: "new_chat_message",
                    content: { msg: data.content.msg }
                };

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(chat));
                    }
                });
                break;
            }
        }
    });

    // --- Desconexão ---
    socket.on("close", () => {
        console.log(`Cliente ${uuid} desconectado.`);
        playerlist.remove(uuid);

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    cmd: "player_disconnected",
                    content: { uuid }
                }));
            }
        });

        // Remover socket das salas
        for (const code in rooms) {
            rooms[code] = rooms[code].filter(s => s !== socket);
            if (rooms[code].length === 0) delete rooms[code];
        }
    });
});
