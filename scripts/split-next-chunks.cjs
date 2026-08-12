const fs = require('fs');
const path = require('path');

const root = path.join('.next', 'static', 'chunks');
const maxPartBytes = 10_000;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

if (!fs.existsSync(root)) {
  throw new Error(`Next.js chunks directory not found: ${root}`);
}

let splitFiles = 0;
let partFiles = 0;

for (const filename of walk(root)) {
  if (!filename.endsWith('.js')) continue;
  const source = fs.readFileSync(filename);
  if (source.length <= maxPartBytes) continue;

  const count = Math.ceil(source.length / maxPartBytes);
  for (let index = 0; index < count; index += 1) {
    const part = source.subarray(index * maxPartBytes, (index + 1) * maxPartBytes);
    fs.writeFileSync(`${filename}.part${index}`, part);
  }

  // Синхронная загрузка здесь намеренная: исходный <script> должен полностью
  // зарегистрировать webpack-модули до выполнения следующего Next.js-чанка.
  const loader = `(()=>{var s=document.currentScript.src.split("?")[0],a=[],z=0;for(var i=0;i<${count};i++){var x=new XMLHttpRequest;x.open("GET",s+".part"+i,false);x.responseType="arraybuffer";x.send();if(x.status<200||x.status>299)throw Error("chunk part "+i+": "+x.status);var u=new Uint8Array(x.response);a.push(u);z+=u.length}var b=new Uint8Array(z),o=0;for(var j=0;j<a.length;j++){b.set(a[j],o);o+=a[j].length}(0,eval)(new TextDecoder().decode(b))})();`;
  fs.writeFileSync(filename, loader);
  splitFiles += 1;
  partFiles += count;
  console.log(`${filename}: ${source.length} bytes -> ${count} parts + ${Buffer.byteLength(loader)} byte loader`);
}

console.log(`Split ${splitFiles} Next.js chunks into ${partFiles} transport-safe parts.`);
