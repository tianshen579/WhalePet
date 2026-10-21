'use strict';
class PetBrain {
  constructor(saved = {}, now = Date.now()) {
    const value = (v, fallback) => Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : fallback;
    this.fullness = value(saved.fullness, 72);
    this.energy = value(saved.energy, 82);
    this.affection = value(saved.affection, 15);
    this.sleeping = saved.sleeping === true;
    this.wander = saved.wander !== false;
    this.kind = this.sleeping ? 'sleep' : 'idle';
    this.until = 0;
    this.lastTick = Number.isFinite(saved.savedAt) ? Math.min(now, saved.savedAt) : now;
    this.lastInteraction = now;
    this.nextWander = now + 12000;
    this.lastPetReward = -Infinity;
    this.lastFeed = -Infinity;
    this.message = '我来陪你啦！';
    this.messageUntil = now + 4000;
    this.tick(now);
  }
  say(text, now, duration = 3500) { this.message = text; this.messageUntil = now + duration; }
  change(kind, duration, now) { this.kind = kind; this.until = duration ? now + duration : 0; }
  tick(now = Date.now()) {
    const minutes = Math.min(480, Math.max(0, now - this.lastTick) / 60000);
    this.lastTick = now;
    this.fullness = Math.max(0, this.fullness - minutes * 0.7);
    this.energy = Math.max(0, Math.min(100, this.energy + minutes * (this.sleeping ? 7 : -0.45)));
    if (this.sleeping && this.energy >= 99.9) {
      this.sleeping = false; this.change('happy', 2600, now); this.say('睡饱了！一起玩吧～', now);
      this.nextWander = now + 12000;
    }
    if (this.until && now >= this.until && this.kind !== 'drag') {
      this.change(this.sleeping ? 'sleep' : 'idle', 0, now);
      this.nextWander = now + 10000;
    }
    if (this.kind === 'idle' && this.energy < 12) {
      this.sleeping = true; this.change('sleep', 0, now); this.say('有点困了，我眯一会儿…', now);
    }
    if (this.kind === 'idle' && this.wander && now >= this.nextWander) {
      this.change('roam', 3600, now);
      this.say(this.fullness < 25 ? '肚子咕噜咕噜…有点想吃白米饭。' : '游一小圈，再回来陪你～', now);
    }
  }
  act(action, now = Date.now()) {
    this.tick(now);
    if (action === 'wander') {
      this.wander = !this.wander;
      if (!this.wander && this.kind === 'roam') this.change('idle', 0, now);
      this.nextWander = now + 10000;
      this.say(this.wander ? '好呀，我会自己逛一逛。' : '我就在这里陪你。', now);
      return;
    }
    if (action === 'sleep') {
      this.sleeping = !this.sleeping;
      this.change(this.sleeping ? 'sleep' : 'happy', this.sleeping ? 0 : 2200, now);
      this.say(this.sleeping ? '晚安啦…呼噜～' : '醒啦！你找我吗？', now);
    } else if (action === 'feed') {
      if (now - this.lastFeed < 8000) { this.say('让我慢慢嚼完这一口～', now); return; }
      if (this.fullness > 95) { this.say('已经吃饱啦，留着待会儿吃吧！', now); return; }
      this.lastFeed = now; this.sleeping = false;
      this.fullness = Math.min(100, this.fullness + 24);
      this.energy = Math.min(100, this.energy + 3);
      this.affection = Math.min(100, this.affection + 2);
      this.change('eat', 5200, now); this.say('啊呜…白米饭好香！谢谢你～', now);
    } else if (action === 'play') {
      if (this.energy < 15) { this.say('先让我休息一会儿，再陪你玩吧。', now); return; }
      if (this.kind === 'play') return;
      this.sleeping = false; this.energy = Math.max(0, this.energy - 8);
      this.fullness = Math.max(0, this.fullness - 3);
      this.affection = Math.min(100, this.affection + 3);
      this.change('play', 4200, now); this.say('接住小鲸鱼！嘿咻～', now);
    } else if (action === 'pet') {
      this.sleeping = false;
      if (now - this.lastPetReward > 8000) { this.affection = Math.min(100, this.affection + 1); this.lastPetReward = now; }
      this.change('happy', 3000, now);
      this.say(this.affection > 45 ? '最喜欢你摸摸头了～' : '嘿嘿，好舒服～', now);
    } else return;
    this.lastInteraction = now; this.nextWander = now + 12000;
  }
  drag(active, now = Date.now()) {
    this.tick(now); this.sleeping = false;
    this.change(active ? 'drag' : 'happy', active ? 0 : 1700, now);
    this.say(active ? '哇！被你抓住啦～' : '安全着陆！', now);
    this.lastInteraction = now; this.nextWander = now + 12000;
  }
  save(now = Date.now()) {
    return { fullness: this.fullness, energy: this.energy, affection: this.affection,
      sleeping: this.sleeping, wander: this.wander, savedAt: now, version: 1 };
  }
}
if (typeof module !== 'undefined') module.exports = PetBrain;
