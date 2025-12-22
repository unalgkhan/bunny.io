const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Statik dosyaları sun (index.html)
app.use(express.static(path.join(__dirname, 'public')));

// --- OYUN SABİTLERİ ---
const WORLD_SIZE = 800;
const MAX_ITEMS = 300;
const SEASON_DURATION = 20000; // 20 saniye

// --- OYUN DURUMU (STATE) ---
let players = {};
let items = [];
let projectiles = [];
let gameState = {
    season: 0, // 0:İlkbahar, 1:Yaz, 2:Sonbahar, 3:Kış
    seasonTimer: Date.now() + SEASON_DURATION
};

// Başlangıç itemlerini oluştur
function spawnItem() {
    if (items.length >= MAX_ITEMS) return;
    const types = ['carrot', 'carrot', 'carrot', 'pepper', 'magnet', 'mushroom', 'gold'];
    const type = types[Math.floor(Math.random() * types.length)];
    const id = Math.random().toString(36).substr(2, 9);
    
    // Rastgele pozisyon (Merkezden biraz dağıt)
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (WORLD_SIZE / 2 - 20);
    
    items.push({
        id: id,
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        type: type
    });
}

for (let i = 0; i < 100; i++) spawnItem();

// --- SOCKET BAĞLANTISI ---
io.on('connection', (socket) => {
    console.log('Yeni oyuncu katıldı:', socket.id);

    // Oyuncu oluştur
    players[socket.id] = {
        id: socket.id,
        x: (Math.random() - 0.5) * 200,
        z: (Math.random() - 0.5) * 200,
        angle: 0,
        score: 10,
        scale: 1,
        name: "Player",
        hat: 0,
        color: Math.floor(Math.random()*16777215), // Rastgele renk
        invincible: 0,
        speedMult: 1
    };

    // Giriş verisini al (İsim ve Şapka)
    socket.on('join_game', (data) => {
        if(players[socket.id]) {
            players[socket.id].name = data.name.substring(0, 12) || "Player";
            players[socket.id].hat = data.hat || 0;
        }
    });

    // Hareket verisini al
    socket.on('input', (data) => {
        const p = players[socket.id];
        if (!p) return;
        
        p.angle = data.angle;
        p.isRunning = data.run;
    });

    socket.on('disconnect', () => {
        console.log('Oyuncu ayrıldı:', socket.id);
        delete players[socket.id];
    });
});

// --- OYUN DÖNGÜSÜ (SERVER TICK 30 FPS) ---
setInterval(() => {
    const now = Date.now();

    // 1. Mevsim Döngüsü
    if (now > gameState.seasonTimer) {
        gameState.season = (gameState.season + 1) % 4;
        gameState.seasonTimer = now + SEASON_DURATION;
        io.emit('season_change', gameState.season);
    }

    // 2. Oyuncu Fiziği & Mantığı
    for (let id in players) {
        let p = players[id];
        let speed = 0.3 * p.speedMult;
        
        // Mevsim Etkileri
        if (gameState.season === 1) speed *= 1.2; // Yazın hızlı
        if (gameState.season === 3) speed *= 0.8; // Kışın yavaş (istemcide kayma efekti var)

        // Koşma Mantığı
        if (p.isRunning && p.score > 5) {
            speed *= 2.0;
            p.score -= 0.05; // Koşarken skor harca
        }

        // Hareket
        if (p.x !== undefined) {
            p.x += Math.sin(p.angle) * speed * 20; // Basit hareket
            p.z += Math.cos(p.angle) * speed * 20;

            // Harita Sınırları
            const dist = Math.hypot(p.x, p.z);
            if (dist > WORLD_SIZE / 2) {
                const ang = Math.atan2(p.z, p.x);
                p.x = Math.cos(ang) * (WORLD_SIZE / 2);
                p.z = Math.sin(ang) * (WORLD_SIZE / 2);
            }
        }

        // Boyut Güncelleme
        let targetScale = 1 + (p.score * 0.008);
        if (targetScale > 50) targetScale = 50;
        p.scale = p.scale * 0.9 + targetScale * 0.1;

        // Item Toplama
        for (let i = items.length - 1; i >= 0; i--) {
            let item = items[i];
            let d = Math.hypot(p.x - item.x, p.z - item.z);
            if (d < p.scale + 2) { // Toplama menzili
                items.splice(i, 1);
                
                // Ödül
                if (item.type === 'carrot') p.score += 5;
                else if (item.type === 'gold') { p.score += 20; p.invincible = now + 5000; }
                else if (item.type === 'pepper') { p.speedMult = 2; setTimeout(()=>{ if(players[id]) players[id].speedMult=1; }, 5000); }
                
                spawnItem(); // Yenisini oluştur
                io.emit('item_collected', item.id); // İstemcilere silmesini söyle
                // Yeni item'i hemen göndermiyoruz, periyodik update halleder
            }
        }
    }

    // 3. Oyuncu vs Oyuncu Çarpışması
    const playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
            let p1 = players[playerIds[i]];
            let p2 = players[playerIds[j]];
            
            if(p1.invincible > now || p2.invincible > now) continue;

            let dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
            let minDist = (p1.scale + p2.scale) * 0.6;

            if (dist < minDist) {
                // Büyük küçüğü yer (Basit mantık)
                if (p1.score > p2.score * 1.1) {
                    p1.score += p2.score * 0.5;
                    io.emit('player_died', { victim: p2.id, killer: p1.id });
                    delete players[p2.id]; // Oyuncuyu öldür
                } else if (p2.score > p1.score * 1.1) {
                    p2.score += p1.score * 0.5;
                    io.emit('player_died', { victim: p1.id, killer: p2.id });
                    delete players[p1.id];
                }
            }
        }
    }

    // Dünya Durumunu Gönder
    io.emit('state_update', { players, items });

}, 1000 / 30); // 30 FPS Server Tick

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
