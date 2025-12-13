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
const MAX_ITEMS = 120; // Eşya sayısı

let players = {};
let projectiles = [];
let traps = [];
let items = [];

// Rastgele Eşya Üretici
function spawnItem() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * (WORLD_SIZE / 2 - 10);
    // Eşya olasılıkları: %60 Havuç, %10 Altın, %10 Biber, %10 Mıknatıs, %10 Mantar
    const rand = Math.random();
    let type = 'carrot';
    if (rand > 0.60) type = 'gold'; 
    if (rand > 0.70) type = 'pepper';
    if (rand > 0.80) type = 'magnet';
    if (rand > 0.90) type = 'mushroom';
    
    return {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.cos(angle) * r,
        z: Math.sin(angle) * r,
        type: type
    };
}

for (let i = 0; i < MAX_ITEMS; i++) items.push(spawnItem());

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: (Math.random()-0.5)*50, z: (Math.random()-0.5)*50,
            angle: 0,
            color: Math.random() * 0xffffff,
            name: data.name || "Oyuncu",
            hat: data.hat || 0,
            score: 20,
            input: { active: false, angle: 0, run: false },
            effects: { ghost: false, speed: false, magnet: false, confused: false }
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
        io.emit('sound', 'shoot'); // Ses efekti sinyali
    });

    socket.on('trap', () => {
        const p = players[socket.id];
        if (!p || p.score < 20) return;
        p.score -= 10;
        traps.push({ id: Math.random().toString(36).substr(2,9), ownerId: p.id, x: p.x, z: p.z, life: 1000 });
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// OYUN DÖNGÜSÜ (60 FPS)
setInterval(() => {
    for (const id in players) {
        const p = players[id];
        
        // HIZ VE EFEKT HESABI
        let speed = 0.3;
        
        if (p.input.run && p.score > 5) { speed *= 2.0; p.score -= 0.05; }
        if (p.effects.speed) speed *= 1.8; // Biber etkisi
        if (p.effects.confused) speed *= 0.6; // Mantar etkisi (Yavaşlatır)

        if (p.input.active) {
            let moveAngle = p.input.angle;
            if(p.effects.confused) moveAngle += Math.PI; // Mantar kafası (Ters yön)

            p.angle = p.input.angle; // Görsel açı değişmez
            p.x += Math.sin(moveAngle) * speed;
            p.z += Math.cos(moveAngle) * speed;
            
            // Harita Sınırı
            if(Math.abs(p.x) > WORLD_SIZE/2) p.x = Math.sign(p.x) * WORLD_SIZE/2;
            if(Math.abs(p.z) > WORLD_SIZE/2) p.z = Math.sign(p.z) * WORLD_SIZE/2;
        }

        // EŞYA TOPLAMA (Mıknatıs Mantığı Dahil)
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            
            // Eğer mıknatıs varsa çekim alanı 3 katına çıkar
            let pickupRange = 2 + (p.score * 0.01);
            if(p.effects.magnet && it.type === 'carrot') pickupRange = 10; 

            // Mesafe kontrolü
            let dist = Math.hypot(p.x - it.x, p.z - it.z);

            // Mıknatıs çekim efekti (Eşyayı oyuncuya yaklaştır)
            if(p.effects.magnet && it.type === 'carrot' && dist < 10) {
                it.x += (p.x - it.x) * 0.1;
                it.z += (p.z - it.z) * 0.1;
            }

            if (dist < pickupRange) {
                // Eşya Özellikleri
                if(it.type === 'carrot') p.score += 2;
                else if(it.type === 'gold') { 
                    p.effects.ghost = true; setTimeout(()=>p.effects.ghost=false, 5000); 
                }
                else if(it.type === 'pepper') { 
                    p.effects.speed = true; setTimeout(()=>p.effects.speed=false, 5000); 
                }
                else if(it.type === 'magnet') { 
                    p.effects.magnet = true; setTimeout(()=>p.effects.magnet=false, 8000); 
                }
                else if(it.type === 'mushroom') { 
                    p.effects.confused = true; setTimeout(()=>p.effects.confused=false, 5000); 
                }
                
                items.splice(i, 1);
                items.push(spawnItem());
            }
        }
    }

    // MERMİLER
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const pr = projectiles[i];
        pr.x += pr.vx; pr.z += pr.vz; pr.life--;
        let hit = false;
        for(let pid in players) {
            if(pid === pr.ownerId) continue;
            const t = players[pid];
            if(t.effects.ghost) continue; // Hayaletse vurulmaz!

            if(Math.hypot(pr.x - t.x, pr.z - t.z) < 1 + (t.score * 0.01)) {
                t.score = Math.max(10, t.score - 10);
                hit = true; break;
            }
        }
        if (pr.life <= 0 || hit) projectiles.splice(i, 1);
    }

    // TUZAKLAR
    for (let i = traps.length - 1; i >= 0; i--) {
        const tr = traps[i]; tr.life--;
        let hit = false;
        for(let pid in players) {
            if(pid === tr.ownerId) continue;
            const t = players[pid];
            if(t.effects.ghost) continue;

            if(Math.hypot(tr.x - t.x, tr.z - t.z) < 2) {
                t.score /= 2; // Yarı yarıya küçült
                hit = true;
            }
        }
        if (tr.life <= 0 || hit) traps.splice(i, 1);
    }

    io.emit('state', {
        players: Object.values(players).map(p => ({
            id: p.id, x: p.x, z: p.z, angle: p.angle, score: p.score, 
            hat: p.hat, color: p.color, name: p.name, 
            isMoving: p.input.active, effects: p.effects
        })),
        items, projectiles, traps
    });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server Ready!'));
