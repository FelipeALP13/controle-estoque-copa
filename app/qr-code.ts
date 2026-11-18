// Gerador de QR code (modo byte, correção de erro nível M, versões 1 a 10), sem bibliotecas.
// Baseado no padrão ISO/IEC 18004 (mesma estrutura do gerador de referência de Nayuki). Usado no QR do autenticador.

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

function rawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (version: number) => Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK_M[version] * BLOCKS_M[version];

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 255;
}

function rsDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]) {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

function alignmentPositions(version: number, size: number) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Matriz do QR code (true = módulo escuro). Erro se o texto não couber na versão 10. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  for (; version <= MAX_VERSION; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new Error("Texto grande demais para o QR code.");

  // Bits: modo byte (0100), tamanho, dados, terminador e preenchimento.
  const bits: number[] = [];
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(4, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

  // Correção de erro por blocos e intercalação.
  const blockCount = BLOCKS_M[version];
  const eccLength = ECC_PER_BLOCK_M[version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (rawCodewords % blockCount);
  const shortLength = Math.floor(rawCodewords / blockCount);
  const divisor = rsDivisor(eccLength);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i += 1) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    blocks.push([...block, ...ecc]);
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    blocks.forEach((block, j) => { if (i !== shortLength - eccLength || j >= shortBlocks) codewords.push(block[i]); });
  }

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFixed = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; fixed[y][x] = true; };

  // Padrões fixos: linhas de tempo, localizadores, alinhamento e áreas de formato/versão.
  for (let i = 0; i < size; i += 1) { setFixed(6, i, i % 2 === 0); setFixed(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFixed(x, y, distance !== 2 && distance !== 4);
    }
  }
  const aligns = alignmentPositions(version, size);
  aligns.forEach((ay, i) => aligns.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === aligns.length - 1) || (i === aligns.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) setFixed(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask: number) => {
    const value = (0 << 3) | mask; // nível M = 00
    let rem = value;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((value << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((format >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) setFixed(8, i, bit(i));
    setFixed(8, 7, bit(6)); setFixed(8, 8, bit(7)); setFixed(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) setFixed(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) setFixed(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) setFixed(8, size - 15 + i, bit(i));
    setFixed(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const value = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((value >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFixed(a, b, dark); setFixed(b, a, dark);
    }
  }

  // Dados em zigue-zague, de baixo para cima, duas colunas por vez.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) for (let j = 0; j < 2; j += 1) {
      const x = right - j;
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - vertical : vertical;
      if (!fixed[y][x] && index < codewords.length * 8) {
        modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
        index += 1;
      }
    }
  }

  // Máscara: escolhe a de menor penalidade (sequências longas, blocos 2x2 e equilíbrio claro/escuro).
  const masked = (mask: number) => modules.map((row, y) => row.map((dark, x) => {
    if (fixed[y][x]) return dark;
    const flip = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
    return flip ? !dark : dark;
  }));
  const penalty = (grid: boolean[][]) => {
    let score = 0;
    const runs = (line: boolean[]) => { let run = 1; for (let i = 1; i <= line.length; i += 1) { if (i < line.length && line[i] === line[i - 1]) run += 1; else { if (run >= 5) score += run - 2; run = 1; } } };
    grid.forEach(runs);
    for (let x = 0; x < size; x += 1) runs(grid.map((row) => row[x]));
    for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) { const c = grid[y][x]; if (c === grid[y][x + 1] && c === grid[y + 1][x] && c === grid[y + 1][x + 1]) score += 3; }
    const dark = grid.flat().filter(Boolean).length;
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  };
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    drawFormat(mask);
    const grid = masked(mask);
    const score = penalty(grid);
    if (score < bestScore) { bestScore = score; best = grid; }
  }
  return best!;
}

/** O QR code como SVG (com margem de 4 módulos), pronto para mostrar na tela. */
export function qrSvg(text: string, pixel = 4) {
  const matrix = qrMatrix(text);
  const size = matrix.length + 8;
  const path = matrix.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + 4} ${y + 4}h1v1h-1z`] : []))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * pixel}" height="${size * pixel}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
