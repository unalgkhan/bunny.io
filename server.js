const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(__dirname));

let players = {};

io.on('connection', (socket) => {
    console.log('Yeni oyuncu:', socket.id);

    // Yeni oyuncu bağlandığında
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: 0,
            z: 0,
            angle: 0,
            name: data.name,
            color: data.color || Math.random() * 0xffffff,
            hat: data.hat || 0,
            score: 10
        };
        // Mevcut oyuncuları yeni gelene gönder
        socket.emit('currentPlayers', players);
        // Yeni geleni diğerlerine duyur
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    // Hareket güncellemesi
    socket.on('playerMove', (data) => {
        if(players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].z = data.z;
            players[socket.id].angle = data.angle;
            players[socket.id].score = data.score; // Skoru da senkronize edelim
        }
    });

    // Şapka değişimi
    socket.on('updateHat', (hatId) => {
        if(players[socket.id]) {
            players[socket.id].hat = hatId;
            socket.broadcast.emit('playerHatChanged', { id: socket.id, hat: hatId });
        }
    });

    // Ayrılma
    socket.on('disconnect', () => {
        console.log('Oyuncu çıktı:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// Saniyede 30 kez güncelleme gönder
setInterval(() => {
    io.emit('stateUpdate', players);
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});

