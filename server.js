const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- OYUN AYARLARI ---
const WORLD_SIZE = 320;
const MAX_ITEMS = 150;
const SPEED = 0.3;

// Oyun Durumu
let players = {};
let projectiles = [];
let traps = [];
let items = [];
let teleporters = [
    {x: -80, z: -80, tx: 80, tz: 80},
    {x: 80, z: 80, tx: -80, tz: -80}
];

// Eşya Üretici (Power-up Dahil)
function spawnItem() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * (WORLD_SIZE / 2 - 10);
    const rand = Math.random();
    let type = 'carrot';
    
    // %20 ihtimalle özel eşya
    if(rand < 0.05) type = 'gold';      // Ölümsüzlük
    else if(rand < 0.10) type = 'pepper'; // Hız
    else if(rand < 0.15) type = 'magnet'; // Mıknatıs
    else if(rand < 0.20) type = 'mushroom'; // Tuzak/Zehir

    return {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.cos(angle) * r,
        z: Math.sin(angle) * r,
        type: type
    };
}

// Başlangıç Eşyaları
for (let i = 0; i < MAX_ITEMS; i++) items.push(spawnItem());

io.on('connection', (socket) => {
    console.log('Oyuncu geldi:', socket.id);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: (Math.random()-0.5)*100, z: (Math.random()-0.5)*100,
            angle: 0,
            color: Math.random()*0xffffff,
            name: data.name || "Player",
            hat: data.hat || 0,
            score: 20,
            input: { active: false, angle: 0, run: false },
            effects: { speed: false, magnet: false, ghost: false, confused: false },
            warpCooldown: 0
        };
        socket.emit('initGame', { id: socket.id });
    });

    socket.on('input', (data) => {
        if (players[socket.id]) players[socket.id].input = data;
    });

    socket.on('shoot', () => {
        const p = players[socket.id];
        if (!p || p.score < 15) return;
        p.score -= 5;
        projectiles.push({
            id: Math.random().toString(36).substr(2,9), ownerId: p.id,
            x: p.x + Math.sin(p.angle)*2, z: p.z + Math.cos(p.angle)*2,
            vx: Math.sin(p.angle)*1.2, vz: Math.cos(p.angle)*1.2, life: 60
        });
        // Sesi herkese duyur
        io.emit('sound', {type: 'pop', x: p.x, z: p.z});
    });

    socket.on('trap', () => {
        const p = players[socket.id];
        if (!p || p.score < 20) return;
        p.score -= 10;
        traps.push({ id: Math.random().toString(36).substr(2,9), ownerId: p.id, x: p.x, z: p.z, life: 1000 });
        io.emit('sound', {type: 'bad', x: p.x, z: p.z});
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// --- OYUN DÖNGÜSÜ (60 FPS) ---
setInterval(() => {
    const now = Date.now();

    for (const id in players) {
        const p = players[id];
        
        // Hız Hesapla
        let currentSpeed = SPEED;
        if (p.effects.speed) currentSpeed *= 1.8; // Biber yemişse
        if (p.effects.confused) currentSpeed *= 0.5; // Mantar yemişse
        if (p.input.run && p.score > 5) {
            currentSpeed *= 2.0;
            p.score -= 0.05;
        }

        // Hareket
        if (p.input.active) {
            let moveAngle = p.input.angle;
            if(p.effects.confused) moveAngle += Math.PI; // Ters yön

            p.angle = p.input.angle; // Görsel açı
            p.x += Math.sin(moveAngle) * currentSpeed;
            p.z += Math.cos(moveAngle) * currentSpeed;

            // Sınırlar
            const limit = WORLD_SIZE/2;
            if(Math.abs(p.x) > limit) p.x = Math.sign(p.x)*limit;
            if(Math.abs(p.z) > limit) p.z = Math.sign(p.z)*limit;
        }

        // Işınlanma (Teleport)
        if(now > p.warpCooldown) {
            teleporters.forEach(tp => {
                if(Math.hypot(p.x - tp.x, p.z - tp.z) < 5) {
                    p.x = tp.tx; p.z = tp.tz;
                    p.warpCooldown = now + 3000;
                    io.emit('effect', {type: 'warp', x: p.x, z: p.z}); // Görsel efekt gönder
                    io.emit('sound', {type: 'warp', x: p.x, z: p.z});
                }
            });
        }

        // Eşya Toplama
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            let pickupRange = 1 + (p.score * 0.01) + 1;
            if(p.effects.magnet && item.type === 'carrot') pickupRange += 8; // Mıknatıs etkisi

            if (Math.hypot(p.x - item.x, p.z - item.z) < pickupRange) {
                // Efektleri Uygula
                if(item.type === 'carrot') {
                    p.score += 2;
                } else if(item.type === 'pepper') {
                    p.effects.speed = true; setTimeout(()=>p.effects.speed=false, 5000);
                    io.emit('msg', {id: p.id, text: "🌶️ HIZ!", color: "red"});
                } else if(item.type === 'gold') {
                    p.effects.ghost = true; setTimeout(()=>p.effects.ghost=false, 5000);
                    io.emit('msg', {id: p.id, text: "👻 GÖRÜNMEZ!", color: "gold"});
                } else if(item.type === 'magnet') {
                    p.effects.magnet = true; setTimeout(()=>p.effects.magnet=false, 5000);
                    io.emit('msg', {id: p.id, text: "🧲 MIKNATIS!", color: "blue"});
                } else if(item.type === 'mushroom') {
                    p.effects.confused = true; setTimeout(()=>p.effects.confused=false, 5000);
                    io.emit('msg', {id: p.id, text: "🍄 KAFAM GÜZEL!", color: "purple"});
                }

                items.splice(i, 1);
                items.push(spawnItem());
                io.emit('sound', {type: 'eat', x: p.x, z: p.z});
            }
        }
    }

    // Mermiler
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        proj.x += proj.vx; proj.z += proj.vz; proj.life--;
        let hit = false;
        
        for (const pid in players) {
            if (pid === proj.ownerId) continue;
            const t = players[pid];
            if(t.effects.ghost) continue; // Hayaletlere işlemez

            if (Math.hypot(proj.x - t.x, proj.z - t.z) < 1 + (t.score * 0.01)) {
                t.score = Math.max(10, t.score - 10);
                if(players[proj.ownerId]) players[proj.ownerId].score += 5;
                hit = true;
                io.emit('sound', {type: 'bad', x: t.x, z: t.z});
                io.emit('msg', {id: t.id, text: "VURULDUN!", color: "red"});
                break;
            }
        }
        if (proj.life <= 0 || hit) projectiles.splice(i, 1);
    }

    // Tuzaklar
    for (let i = traps.length - 1; i >= 0; i--) {
        const t = traps[i];
        t.life--;
        let triggered = false;
        for (const pid in players) {
            if (pid === t.ownerId) continue;
            const pl = players[pid];
            if(pl.effects.ghost) continue;

            if (Math.hypot(t.x - pl.x, t.z - pl.z) < 2) {
                pl.score = Math.max(10, pl.score / 2); // YARI YARIYA!
                triggered = true;
                io.emit('sound', {type: 'bad', x: pl.x, z: pl.z});
                io.emit('msg', {id: pl.id, text: "TUZAĞA BASTIN!", color: "purple"});
            }
        }
        if (t.life <= 0 || triggered) traps.splice(i, 1);
    }

    // Veri Paketi
    const packet = {
        players: Object.values(players).map(p => ({
            id: p.id, x: p.x, z: p.z, angle: p.angle, score: p.score, 
            hat: p.hat, color: p.color, name: p.name, effects: p.effects
        })),
        projectiles, traps, items
    };

    io.emit('state', packet);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Ultimate Server running on ${PORT}`));
