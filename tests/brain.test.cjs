const test = require('node:test');
const assert = require('node:assert/strict');
const Brain = require('../app/src/main/assets/brain.js');
const t = 1000000;
test('feeding white rice changes fullness and runs eating before returning idle', () => {
 const b=new Brain({},t);const old=b.fullness;b.act('feed',t);
 assert.equal(b.kind,'eat');assert.equal(b.fullness,old+24);assert.match(b.message,/白米饭/);
 b.act('feed',t+100);assert.ok(b.fullness<=old+24);b.tick(t+5300);assert.equal(b.kind,'idle');
});
test('full pet refuses food and never exceeds 100',()=>{
 const b=new Brain({fullness:99},t);b.act('feed',t);assert.equal(b.kind,'idle');assert.equal(b.fullness,99);assert.match(b.message,/吃饱/);
});
test('sleep restores energy; persistent state applies elapsed offline time',()=>{
 const b=new Brain({energy:35},t);b.act('sleep',t);b.tick(t+120000);assert.equal(b.kind,'sleep');assert.ok(b.energy>48);
 const c=new Brain(b.save(t+120000),t+240000);assert.equal(c.sleeping,true);assert.ok(c.energy>b.energy);assert.ok(c.fullness<b.fullness);
});
test('waking, dragging, and landing override sleep cleanly',()=>{
 const b=new Brain({},t);b.act('sleep',t);b.drag(true,t+1000);assert.equal(b.sleeping,false);assert.equal(b.kind,'drag');
 b.tick(t+99999);assert.equal(b.kind,'drag');b.drag(false,t+100000);assert.equal(b.kind,'happy');b.tick(t+102000);assert.equal(b.kind,'idle');
});
test('pet rewards have cooldown and playing costs energy',()=>{
 const b=new Brain({},t);b.act('pet',t);const love=b.affection;b.act('pet',t+500);assert.equal(b.affection,love);
 const energy=b.energy;b.act('play',t+1000);assert.ok(b.energy<energy-7);assert.equal(b.kind,'play');
});
test('autonomous motion can be stopped; exhausted pet rests',()=>{
 const b=new Brain({},t);b.tick(t+13000);assert.equal(b.kind,'roam');b.act('wander',t+13001);assert.equal(b.kind,'idle');assert.equal(b.wander,false);
 b.tick(t+99999);assert.equal(b.kind,'idle');const tired=new Brain({energy:5},t);assert.equal(tired.kind,'sleep');
});
test('corrupt saved numbers and clock reversal remain bounded',()=>{
 const b=new Brain({fullness:-100,energy:Infinity,affection:500,savedAt:t+999999},t);
 assert.equal(b.fullness,0);assert.equal(b.energy,82);assert.equal(b.affection,100);b.tick(t-3000);assert.ok(Number.isFinite(b.energy));
});
