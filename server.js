const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const WORLD_SIZE = 320;
const MAX_CARROTS = 100;
let players = {};
let projectiles = [];
let traps = [];
let carrots = [];

function spawnCarrot() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * (WORLD_SIZE / 2 - 10);
    return { id: Math.random().toString(36).substr(2, 9), x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}
for (let i = 0; i < MAX_CARROTS; i++) carrots.push(spawnCarrot());

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id, x: (Math.random()-0.5)*100, z: (Math.random()-0.5)*100,
            angle: 0, color: Math.random()*0xffffff, name: data.name || "Player",
            hat: data.hat || 0, score: 20, input: { active: false, angle: 0, run: false }
        };
        socket.emit('initGame', { id: socket.id });
    });

    socket.on('input', (data) => { if (players[socket.id]) players[socket.id].input = data; });

    socket.on('shoot', () => {
        const p = players[socket.id];
        if (!p || p.score < 15) return;
        p.score -= 5;
        projectiles.push({
            id: Math.random().toString(36).substr(2,9), ownerId: p.id,
            x: p.x + Math.sin(p.angle)*2, z: p.z + Math.cos(p.angle)*2,
            vx: Math.sin(p.angle)*1.2, vz: Math.cos(p.angle)*1.2, life: 60
        });
    });

    socket.on('trap', () => {
        const p = players[socket.id];
        if (!p || p.score < 20) return;
        p.score -= 10;
        traps.push({ id: Math.random().toString(36).substr(2,9), ownerId: p.id, x: p.x, z: p.z, life: 1000 });
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

setInterval(() => {
    for (const id in players) {
        const p = players[id];
        let speed = 0.3;
        if (p.input.run && p.score > 5) { speed *= 2.5; p.score -= 0.05; }
        if (p.input.active) {
            p.angle = p.input.angle;
            p.x += Math.sin(p.angle)*speed; p.z += Math.cos(p.angle)*speed;
            if(Math.abs(p.x)>WORLD_SIZE/2) p.x = Math.sign(p.x)*WORLD_SIZE/2;
            if(Math.abs(p.z)>WORLD_SIZE/2) p.z = Math.sign(p.z)*WORLD_SIZE/2;
        }
        for (let i=carrots.length-1; i>=0; i--) {
            if(Math.hypot(p.x-carrots[i].x, p.z-carrots[i].z) < 1+(p.score*0.01)+1) {
                p.score += 2; carrots.splice(i,1); carrots.push(spawnCarrot());
            }
        }
    }
    for (let i=projectiles.length-1; i>=0; i--) {
        let p = projectiles[i]; p.x+=p.vx; p.z+=p.vz; p.life--;
        let hit = false;
        for(let pid in players) {
            if(pid===p.ownerId) continue;
            let t = players[pid];
            if(Math.hypot(p.x-t.x, p.z-t.z) < 1+(t.score*0.01)) {
                t.score = Math.max(10, t.score-10); hit=true; break;
            }
        }
        if(p.life<=0 || hit) projectiles.splice(i,1);
    }
    for (let i=traps.length-1; i>=0; i--) {
        let t = traps[i]; t.life--;
        let trig = false;
        for(let pid in players) {
            if(pid===t.ownerId) continue;
            if(Math.hypot(t.x-players[pid].x, t.z-players[pid].z) < 2) {
                players[pid].score /= 2; trig=true;
            }
        }
        if(t.life<=0 || trig) traps.splice(i,1);
    }

    io.emit('state', { 
        players: Object.values(players).map(p=>({id:p.id, x:p.x, z:p.z, angle:p.angle, score:p.score, hat:p.hat, color:p.color, name:p.name})),
        projectiles, traps, carrots
    });
}, 1000/60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));