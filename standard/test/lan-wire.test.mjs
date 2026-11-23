import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {lanWire} from '../desktop/lan-wire.mjs';
const secret='0123456789abcdef0123456789abcdef',identity='PB-LAN2|test|1.1.0|build|'+('a'.repeat(64));
const wait=()=>new Promise(r=>setImmediate(r));
class Socket extends EventEmitter{
  writableLength=0;ended=false;
  setNoDelay(){}setTimeout(){}
  write(bytes){if(this.ended)return false;const b=Buffer.from(bytes);if(this.filter)this.filter(b);else queueMicrotask(()=>this.peer.emit('data',b));return true;}
  destroy(){if(this.ended)return;this.ended=true;queueMicrotask(()=>{this.emit('close');this.peer.emit('close');});}
}
function pair(options={}){
  const a=new Socket,b=new Socket;a.peer=b;b.peer=a;let opens=0,reason,received=[];
  const host=lanWire(a,{host:true,identity,secret},{open:()=>opens++,message:v=>received.push(v),close:r=>{reason??=r;}});
  const client=lanWire(b,{host:false,identity:options.identity??identity,secret:options.secret??secret},{open:()=>opens++,message:v=>received.push(v),close:r=>{reason??=r;}});
  return {a,b,host,client,opens:()=>opens,reason:()=>reason,received,close(){host.close();client.close();}};
}
test('native pairing authenticates both sides and encrypted records reject replay',async()=>{
  const p=pair();try{
    for(let i=0;i<8;i++)await wait();assert.equal(p.opens(),2);
    let packet;p.a.filter=bytes=>{packet??=Buffer.from(bytes);queueMicrotask(()=>p.b.emit('data',bytes));};
    p.host.send({op:'test',payload:1});await wait();assert.equal(p.received.length,1);
    p.b.emit('data',packet);await wait();assert.match(p.reason(),/replayed/);assert.equal(p.received.length,1);
  }finally{p.close();}
});
test('wrong pairing key/build and corrupted ciphertext never become room messages',async()=>{
  for(const options of [{secret:'f'.repeat(32)},{identity:identity+'wrong'}]){
    const p=pair(options);for(let i=0;i<8;i++)await wait();assert.equal(p.opens(),0);assert.ok(p.reason());p.close();
  }
  const p=pair();try{for(let i=0;i<8;i++)await wait();p.a.filter=b=>{b[b.length-1]^=1;queueMicrotask(()=>p.b.emit('data',b));};p.host.send({op:'tampered'});await wait();assert.equal(p.received.length,0);assert.ok(p.reason());}finally{p.close();}
});
const javaHome=process.env.JAVA_HOME??'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
for(const javaHost of [false,true])test(`Java/Node encrypted signaling interoperates with ${javaHost?'Java':'Node'} hosting`,{timeout:30000},async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'pokebonk-lan-java-'));let child,server,wire;
  try{
    execFileSync(path.join(javaHome,'bin/javac'),['-d',tmp,'standard/android/app/src/main/java/dev/nicartjay/pokebonk/offline/standard/LanWire.java','standard/test/fixtures/lan/LanWirePeer.java']);
    let resolveSocket;const socketReady=new Promise(r=>{resolveSocket=r;});
    let port=0;if(!javaHost){server=net.createServer(socket=>resolveSocket(socket));await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;}
    child=spawn(path.join(javaHome,'bin/java'),['-cp',tmp,'dev.nicartjay.pokebonk.offline.standard.LanWirePeer',javaHost?'server':'client',String(port),secret,identity],{stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',b=>{errors+=b;});
    if(javaHost){const port=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',b=>{text+=b;const m=/PORT (\d+)/.exec(text);if(m)resolve(+m[1]);});child.once('exit',code=>reject(Error('Java exited '+code+errors)));});resolveSocket(net.connect(port,'127.0.0.1'));}
    const socket=await socketReady;let resolveDone;const done=new Promise(r=>{resolveDone=r;});const seen=new Set();
    wire=lanWire(socket,{host:!javaHost,identity,secret},{open:()=>wire.send({op:'node'}),message:v=>{seen.add(v.op);if(seen.has('java')&&seen.has('ack')){wire.send({op:'done'});resolveDone();}},close:()=>{}});
    await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Java/Node pairing timed out '+errors)),12000).unref())]);
    assert.ok(seen.has('java'));assert.ok(seen.has('ack'));
  }finally{wire?.close();child?.kill();if(server)await new Promise(r=>server.close(r));await rm(tmp,{recursive:true,force:true});}
});
