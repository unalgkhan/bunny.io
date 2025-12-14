const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Dosyaları aynı klasörden sun (GitHub/Render yapına uygun)
app.use(express.static(__dirname));

// OYUN DURUMU
let players = {};
let items = []; // Havuçlar sunucuda tutulacak
const WORLD_SIZE = 800;
const ITEM_COUNT = 300; // Toplam eşya sayısı

// Sunucu başladığında havuçları yarat
function spawnItems() {
    items = [];
    for (let i = 0; i < ITEM_COUNT; i++) {
        let type = 'carrot';
        const r = Math.random();
        if (r < 0.05) type = 'magnet';
        else if (r < 0.10) type = 'pepper';
        else if (r < 0.15) type = 'gold';
        else if (r < 0.20) type = 'mushroom';

        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (WORLD_SIZE / 2 - 10);

        items.push({
            id: i, // Benzersiz ID
            type: type,
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius
        });
    }
}
spawnItems();

io.on('connection', (socket) => {
    console.log('Oyuncu girdi:', socket.id);

    // 1. OYUNA KATILMA
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: (Math.random() - 0.5) * 100,
            z: (Math.random() - 0.5) * 100,
            angle: 0,
            name: data.name,
            color: data.color || Math.random() * 0xffffff,
            hat: data.hat || 0,
            score: 10,
            isMoving: false // Animasyon için eklendi
        };

        // Yeni oyuncuya mevcut durumu gönder
        socket.emit('initGame', { players: players, items: items, myId: socket.id });
        
        // Diğerlerine yeni oyuncuyu haber ver
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    // 2. HAREKET GÜNCELLEMESİ
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].z = data.z;
            players[socket.id].angle = data.angle;
            players[socket.id].isMoving = data.isMoving; // Hareket ediyor mu?
        }
    });

    // 3. EŞYA YEME (İSTEMCİDEN GELEN TALEP)
    socket.on('requestEatItem', (itemId) => {
        const itemIndex = items.findIndex(i => i.id === itemId);
        if (itemIndex !== -1) {
            const item = items[itemIndex];
            items.splice(itemIndex, 1); // Sunucudan sil
            
            // Oyuncuya puan ver
            if(players[socket.id]) {
                players[socket.id].score += (item.type === 'carrot' ? 5 : 0);
            }

            // Herkese haber ver (Silsinler ve ses çalsınlar)
            io.emit('itemRemoved', { itemId: itemId, eaterId: socket.id, type: item.type });

            // Eksilen eşya yerine yenisini koy (sonsuz döngü için)
            setTimeout(() => {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * (WORLD_SIZE / 2 - 10);
                const newItem = {
                    id: Math.floor(Math.random() * 999999), // Rastgele ID
                    type: 'carrot', // Genelde havuç doğsun
                    x: Math.cos(angle) * radius,
                    z: Math.sin(angle) * radius
                };
                items.push(newItem);
                io.emit('itemSpawned', newItem);
            }, 5000);
        }
    });

    // 4. OYUNCU YEME (KILL)
    socket.on('killPlayer', (victimId) => {
        const killer = players[socket.id];
        const victim = players[victimId];

        if (killer && victim) {
            // Basit hile koruması: Puan farkı kontrolü
            // (Burayı daha sonra mesafe kontrolü ile güçlendirebiliriz)
            killer.score += victim.score * 0.5;

            // Ölene "Öldün" mesajı at
            io.to(victimId).emit('youDied', { killerName: killer.name, score: victim.score });
            
            // Herkese "Bu oyuncu silindi" mesajı at
            io.emit('playerKilled', { victimId: victimId, killerId: socket.id });

            // Sunucudan kaydı sil
            delete players[victimId];
        }
    });

    socket.on('updateHat', (hatId) => {
        if (players[socket.id]) {
            players[socket.id].hat = hatId;
            socket.broadcast.emit('playerHatChanged', { id: socket.id, hat: hatId });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

// 30 FPS Güncelleme Döngüsü
setInterval(() => {
    io.emit('stateUpdate', players);
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu aktif: ${PORT}`);
});

