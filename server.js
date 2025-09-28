const express = require("express");
const WebSocket = require("ws");
const { v4 } = require("uuid");
const playerlist = require("./playerlist.js");

const app = express();

// Render exige que a porta seja obtida via variável de ambiente
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log("Server listening on port: " + PORT);
});

// Configura WebSocket sobre o mesmo server
const wss = new WebSocket.Server({ server });

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

    // Informar novos jogadores para os demais
    wss.clients.forEach((client) => {
        if (client !== socket && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                cmd: "spawn_new_player",
                content: { msg: "Spawning new network player!", player: newPlayer }
            }));
        }
    });

    // Enviar todos os jogadores existentes ao novo cliente
    socket.send(JSON.stringify({
        cmd: "spawn_network_players",
        content: {
            msg: "Spawning network players!",
            players: await playerlist.getAll()
        }
    }));

    // --- Receber mensagens do cliente ---
    socket.on("message", (message) => {
        let data;
        try {
            data = JSON.parse(message.toString());
        } catch (err) {
            console.error("Erro ao fazer parse do JSON:", err);
            return;
        }

        // Atualizar posição do player
        if (data.cmd === "position") {
            playerlist.update(uuid, data.content.x, data.content.y);

            const update = {
                cmd: "update_position",
                content: { uuid, x: data.content.x, y: data.content.y }
            };

            wss.clients.forEach((client) => {
                if (client !== socket && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(update));
                }
            });
        }

        // Chat
        if (data.cmd === "chat") {
            const chat = { cmd: "new_chat_message", content: { msg: data.content.msg } };
            wss.clients.forEach((client) => {
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

        // Avisar os outros jogadores
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    cmd: "player_disconnected",
                    content: { uuid }
                }));
            }
        });
    });
});
