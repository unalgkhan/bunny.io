const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// --- OYUN AYARLARI ---
const WORLD_SIZE = 1000; // Harita biraz daha büyük
const MAX_ITEMS = 400;
const SEASON_DURATION = 15000; // 15 saniyede bir mevsim değişsin

// --- STATE ---
let players = {};
let items = [];
let gameState = {
    season: 0, // 0:İlkbahar, 1:Yaz, 2:Sonbahar, 3:Kış
    seasonTimer: Date.now() + SEASON_DURATION
};

// Yardımcı: Rastgele ID
const uid = () => Math.random().toString(36).substr(2, 9);

// İtem Oluşturucu
function spawnItem(forceType = null) {
    if (items.length >= MAX_ITEMS) return;
    const types = ['carrot', 'carrot', 'carrot', 'carrot', 'pepper', 'magnet', 'mushroom', 'gold'];
    const type = forceType || types[Math.floor(Math.random() * types.length)];
    
    // Harita içinde rastgele konum
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (WORLD_SIZE / 2 - 20);
    
    items.push({
        id: uid(),
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        type: type
    });
}

// Başlangıç itemleri
for (let i = 0; i < 200; i++) spawnItem();

io.on('connection', (socket) => {
    console.log('Oyuncu geldi:', socket.id);

    // Yeni oyuncu
    players[socket.id] = {
        id: socket.id,
        x: (Math.random() - 0.5) * 200,
        z: (Math.random() - 0.5) * 200,
        angle: 0,
        score: 10,
        scale: 1,
        name: "Player",
        hat: 0,
        color: Math.floor(Math.random()*16777215),
        run: false,
        speedMult: 1,
        invincibleUntil: 0
    };

    socket.on('join_game', (data) => {
        if(players[socket.id]) {
            players[socket.id].name = (data.name || "Player").substring(0, 12);
            players[socket.id].hat = data.hat || 0;
        }
        // Oyuncuya mevcut durumu hemen bildir
        socket.emit('init_game', { id: socket.id, season: gameState.season });
    });

    socket.on('input', (data) => {
        const p = players[socket.id];
        if (p) {
            p.angle = data.angle;
            p.run = data.run;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// --- OYUN DÖNGÜSÜ (30 FPS) ---
setInterval(() => {
    const now = Date.now();

    // Mevsim Kontrolü
    if (now > gameState.seasonTimer) {
        gameState.season = (gameState.season + 1) % 4;
        gameState.seasonTimer = now + SEASON_DURATION;
        io.emit('season_change', gameState.season);
    }

    // Fizik ve Mantık
    for (let id in players) {
        let p = players[id];
        let baseSpeed = 0.4; // Temel hız

        // Hız Çarpanları
        let speed = baseSpeed * p.speedMult;
        if (gameState.season === 1) speed *= 1.2; // Yaz bonusu
        if (gameState.season === 3) speed *= 0.8; // Kış cezası

        // Koşma (Skor harcar)
        if (p.run && p.score > 5) {
            speed *= 2.0;
            p.score = Math.max(1, p.score - 0.1);
        }

        // Hareket
        p.x += Math.sin(p.angle) * speed * 25; // Delta time simülasyonu
        p.z += Math.cos(p.angle) * speed * 25;

        // Harita Sınırı
        const dist = Math.hypot(p.x, p.z);
        if (dist > WORLD_SIZE / 2) {
            const ang = Math.atan2(p.z, p.x);
            p.x = Math.cos(ang) * (WORLD_SIZE / 2);
            p.z = Math.sin(ang) * (WORLD_SIZE / 2);
        }

        // Scale Hesapla (Yumuşak geçiş istemcide yapılacak, burada ham değer)
        let targetScale = 1 + (p.score * 0.01);
        if (targetScale > 40) targetScale = 40;
        p.scale = targetScale;

        // İtem Toplama
        for (let i = items.length - 1; i >= 0; i--) {
            let item = items[i];
            let d = Math.hypot(p.x - item.x, p.z - item.z);
            let pickupRange = p.scale + 4; // Biraz tolerans

            if (d < pickupRange) {
                // Efekt verisi topla
                let gain = 0;
                if (item.type === 'carrot') { p.score += 5; gain = 5; }
                else if (item.type === 'gold') { p.score += 30; p.invincibleUntil = now + 5000; gain = 30; }
                else if (item.type === 'pepper') { 
                    p.speedMult = 2; 
                    setTimeout(() => { if(players[id]) players[id].speedMult = 1; }, 4000);
                }
                
                // İtemi sil ve yenisini oluştur
                const collectedId = item.id;
                items.splice(i, 1);
                spawnItem();
                
                // Olayı herkese duyur (Ses ve efekt için)
                io.emit('item_event', { id: collectedId, playerId: p.id, type: item.type, gain: gain });
            }
        }
    }

    // Çarpışma (PvP)
    const pIds = Object.keys(players);
    for (let i = 0; i < pIds.length; i++) {
        for (let j = i + 1; j < pIds.length; j++) {
            let p1 = players[pIds[i]];
            let p2 = players[pIds[j]];

            if (p1.invincibleUntil > now || p2.invincibleUntil > now) continue;

            let d = Math.hypot(p1.x - p2.x, p1.z - p2.z);
            let minDist = (p1.scale + p2.scale) * 0.8;

            if (d < minDist) {
                // Büyük olan yer
                if (p1.score > p2.score * 1.1) {
                    killPlayer(p1, p2);
                } else if (p2.score > p1.score * 1.1) {
                    killPlayer(p2, p1);
                } else {
                    // Kafa kafaya çarpışma (İtme efekti eklenebilir)
                }
            }
        }
    }

    // Durumu Gönder
    io.emit('update', { players, items });

}, 30); // ~33ms

function killPlayer(killer, victim) {
    killer.score += victim.score * 0.4;
    io.emit('kill_event', { killerId: killer.id, victimId: victim.id, x: victim.x, z: victim.z });
    
    // Ölen oyuncuyu respawn et (Skoru sıfırla, yerini değiştir)
    victim.score = 10;
    victim.x = (Math.random() - 0.5) * 300;
    victim.z = (Math.random() - 0.5) * 300;
    victim.invincibleUntil = Date.now() + 3000;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
