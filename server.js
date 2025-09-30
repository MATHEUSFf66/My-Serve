const express = require("express");
const WebSocket = require("ws");
const { v4 } = require("uuid");
const playerlist = require("./playerlist.js");

const app = express();

// Rota HTTP mínima
app.get("/", (req, res) => {
    res.send("Servidor WebSocket ativo! ✅");
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log("Server listening on port:", PORT);
});

const wss = new WebSocket.Server({ server });
const rooms = {}; // { roomCode: [ws, ws, ...] }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on("connection", (socket) => {
    const uuid = v4();

    playerlist.add(uuid).then(() => {
        const newPlayer = playerlist.get(uuid);

        // Envia UUID e spawn local
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ cmd:"joined_server", content:{ uuid } }));
            socket.send(JSON.stringify({ cmd:"spawn_local_player", content:{ player:newPlayer } }));
            socket.send(JSON.stringify({ cmd:"spawn_network_players", content:{ players:playerlist.getAll() } }));

            // Notifica outros players
            wss.clients.forEach(client => {
                if (client !== socket && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ cmd:"spawn_new_player", content:{ player:newPlayer } }));
                }
            });
        }
    });

    socket.on("message", (message) => {
        let data;
        try { data = JSON.parse(message.toString()); } 
        catch { return; }

        switch(data.cmd){
            case "create_room": {
                const roomCode = generateRoomCode();
                rooms[roomCode] = [socket];
                socket.send(JSON.stringify({ cmd:"room_created", content:{ code:roomCode } }));
                break;
            }
            case "join_room": {
                const roomCode = data.content.code;
                if (!rooms[roomCode]) {
                    socket.send(JSON.stringify({ cmd:"server_error", content:{ msg:"Sala não encontrada!" } }));
                    return;
                }
                rooms[roomCode].push(socket);
                rooms[roomCode].forEach(client => {
                    if(client.readyState===WebSocket.OPEN) client.send(JSON.stringify({ cmd:"room_joined", content:{ code:roomCode } }));
                });
                if(rooms[roomCode].length >= 2){
                    rooms[roomCode].forEach(client => {
                        if(client.readyState===WebSocket.OPEN) client.send(JSON.stringify({ cmd:"start_game" }));
                    });
                }
                break;
            }
            case "position": {
                playerlist.update(uuid, data.content.x, data.content.y);
                const update = { cmd:"update_position", content:{ uuid, x:data.content.x, y:data.content.y } };
                wss.clients.forEach(client => { if(client!==socket && client.readyState===WebSocket.OPEN) client.send(JSON.stringify(update)); });
                break;
            }
            case "chat": {
                const chat = { cmd:"new_chat_message", content:{ msg:data.content.msg } };
                wss.clients.forEach(client => { if(client.readyState===WebSocket.OPEN) client.send(JSON.stringify(chat)); });
                break;
            }
        }
    });

    socket.on("close", () => {
        playerlist.remove(uuid);
        wss.clients.forEach(client => { if(client.readyState===WebSocket.OPEN) client.send(JSON.stringify({ cmd:"player_disconnected", content:{ uuid } })); });

        // Remove da sala
        for(const code in rooms){
            rooms[code] = rooms[code].filter(s=>s!==socket);
            if(rooms[code].length===0) delete rooms[code];
        }
    });
});
