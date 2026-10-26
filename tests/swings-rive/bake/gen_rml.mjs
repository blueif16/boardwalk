import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "rive");
const meta = JSON.parse(readFileSync(join(dir, "atlas.json"), "utf8"));
const SLOTS = 9;
const s = 1 / meta.scale;
const [, , bw, bh] = meta.box;
let next = 100;
const id = () => `0:${next++}`;
const f = (v) => +v.toFixed(3);

const image = (asset, name) => `<Image assetId="${asset}" originX="0" originY="0" scaleX="${s}" scaleY="${s}" name="${name}" id="${id()}"/>`;

function clipped(name, asset, cw, ch, ax, ay) {
  const mask = id();
  return `<Node name="${name}" id="${id()}">
  <Node name="${name}_clip" id="${id()}">
    <ClippingShape sourceId="${mask}" name="${name}_clipper"/>
    <Node name="${name}_img" id="${id()}">
      ${image(asset, `${name}_image`)}
    </Node>
  </Node>
  <Shape x="${f(-ax * s)}" y="${f(-ay * s)}" name="${name}_mask" id="${mask}">
    <Rectangle width="${f(cw * s)}" height="${f(ch * s)}" originX="0" originY="0" name="${name}_rect"/>
  </Shape>
</Node>`;
}

const chain = (name) => `<Node name="${name}" scaleX="0" scaleY="0" id="${id()}">
  <Shape name="${name}_shape" id="${id()}">
    <Rectangle width="1.1" height="1" originX="0.5" originY="0" name="${name}_rect"/>
    <Fill name="${name}_fill"><SolidColor colorValue="FF7A6662" name="${name}_color"/></Fill>
  </Shape>
</Node>`;

const c = meta.chairs;
const seat = (name) => clipped(name, "0:10", c.cw, c.ch, c.ax, c.ay).replace(`<Node name="${name}" id=`, `<Node name="${name}" scaleX="0" scaleY="0" id=`);
const range = (n) => Array.from({ length: n }, (_, i) => n - 1 - i);

const parts = [];
for (const i of range(SLOTS)) parts.push(seat(`fs${i}`));
parts.push(clipped("canopy", "0:11", meta.canopy.cw, meta.canopy.ch, 0, 0).replace(`<Node name="canopy" id=`, `<Node name="canopy" x="${meta.canopy.x}" y="${meta.canopy.y}" id=`));
for (const i of range(SLOTS)) parts.push(`<Node name="fc${i}" id="${id()}">\n${chain(`fc${i}a`)}\n${chain(`fc${i}b`)}\n</Node>`);
parts.push(`<Node name="tower" x="${meta.tower.x}" y="${meta.tower.y}" id="${id()}">\n${image("0:12", "tower_image")}\n</Node>`);
for (const i of range(SLOTS)) parts.push(`<Node name="b${i}" id="${id()}">\n${seat(`b${i}s`)}\n${chain(`b${i}a`)}\n${chain(`b${i}b`)}\n</Node>`);

const rml = `<Rive version="1" kind="fragment">
<ImageAsset file="chairs.webp" name="chairs" id="0:10"/>
<ImageAsset file="canopy.webp" name="canopy" id="0:11"/>
<ImageAsset file="tower.webp" name="tower" id="0:12"/>
<Artboard width="${bw}" height="${bh}" clip="false" name="Swings" id="0:2">
${parts.join("\n")}
</Artboard>
</Rive>
`;
writeFileSync(join(dir, "scene.rml"), rml);
writeFileSync(join(dir, "rive.yaml"), "name: swings\n");
console.log(`scene.rml: ${rml.length} chars, ${next - 100} ids`);
