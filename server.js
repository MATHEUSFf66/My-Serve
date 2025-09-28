const express = require("express");
const WebSocket = require("ws");
const { v4 } = require("uuid");
const playerlist = require("./playerlist.js");

const app = express();
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log("Server listening on port:", PORT);
});

// --- WebSocket Server ---
const wss = new WebSocket.Server({ server });

// --- Sistema de salas ---
const rooms = {}; // { room_code: [uuid1, uuid2, ...] }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// --- Conexão de clientes ---
wss.on("connection", async (socket) => {
    const uuid = v4();
    await playerlist.add(uuid);
    const newPlayer = await playerlist.get(uuid);

    // Enviar UUID ao cliente
    socket.send(JSON.stringify({
        cmd: "joined_server",
        content: { msg: "Bem-vindo ao servidor!", uuid }
    }));

    // --- Receber mensagens do cliente ---
    socket.on("message", async (message) => {
        let data;
        try { data = JSON.parse(message.toString()); }
        catch (err) { console.error("JSON inválido:", err); return; }

        // --- Criar sala ---
        if (data.cmd === "create_room") {
            const roomCode = generateRoomCode();
            rooms[roomCode] = [uuid];

            socket.send(JSON.stringify({
                cmd: "room_created",
                content: { code: roomCode }
            }));

            console.log(`Sala criada: ${roomCode} por ${uuid}`);
        }

        // --- Entrar em sala existente ---
        if (data.cmd === "join_room") {
            const code = data.content.code;
            if (rooms[code]) {
                rooms[code].push(uuid);

                socket.send(JSON.stringify({
                    cmd: "room_joined",
                    content: { code }
                }));

                console.log(`${uuid} entrou na sala ${code}`);
            } else {
                socket.send(JSON.stringify({
                    cmd: "server_error",
                    content: { msg: "Sala não encontrada!" }
                }));
            }
        }

        // --- Atualizar posição ---
        if (data.cmd === "position") {
            playerlist.update(uuid, data.content.x, data.content.y);
            const update = { cmd: "update_position", content: { uuid, x: data.content.x, y: data.content.y } };

            wss.clients.forEach(client => {
                if (client !== socket && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(update));
                }
            });
        }

        // --- Chat ---
        if (data.cmd === "chat") {
            const chat = { cmd: "new_chat_message", content: { msg: data.content.msg } };
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(chat));
                }
            });
        }
    });

    // --- Desconexão ---
    socket.on("close", () => {
        console.log(`Cliente ${uuid} desconectado.`);
        playerlist.remove(uuid);

        // Remover da sala
        for (let code in rooms) {
            rooms[code] = rooms[code].filter(id => id !== uuid);
            if (rooms[code].length === 0) delete rooms[code];
        }

        // Avisar outros jogadores
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    cmd: "player_disconnected",
                    content: { uuid }
                }));
            }
        });
    });
});

// --- Rota de teste REST ---
app.get("/health", (req, res) => {
    res.send("Server is running!");
});
