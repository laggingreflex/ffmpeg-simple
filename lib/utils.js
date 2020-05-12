const OS = require('os');
const Path = require('path');
const fs = require('fs-extra');
const prettyBytes = require('pretty-bytes');
const prettyMs = require('pretty-ms');

const _ = exports;

_.defaults = {
  cwd: process.cwd(),
  homedir: OS.homedir(),
  tmpdir: OS.tmpdir(),
  timeout: Infinity,
  limit: Infinity,
  bail: false,
  stat: true,
};

_.normalize = (path, {
  cwd = _.defaults.cwd,
  homedir = _.defaults.homedir,
} = {}) => {
  if (Array.isArray(path)) path = Path.join(...path);
  if (Path.isAbsolute(path)) return path;
  if (path.startsWith('~')) return Path.join(homedir, path.substr(1));
  return Path.join(cwd, path);
};

_.stat = async file => {
  const stats = await fs.stat(file);
  return {
    size: stats.size,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    atime: stats.atimeMs,
    mtime: stats.mtimeMs,
    ctime: stats.ctimeMs,
  }
}

_.arrify = x => Array.isArray(x) ? x : x === undefined ? [] : [x];
_.unique = arr => Array.from(new Set(arr));


_.stdoutLine = str => {
  process.stdout.clearLine();
  process.stdout.write(str);
  process.stdout.cursorTo(0);
};

_.safeInteger = n => Math.min(n || 0, Number.MAX_SAFE_INTEGER);
_.prettyMs = (ms, opts) => prettyMs(_.safeInteger(ms), { ...opts });
_.prettyS = (s, opts) => _.prettyMs(s * 1000, { ...opts });
_.prettyBytes = (size, opts) => prettyBytes(_.safeInteger(size), { ...opts });

_.percentString = percent => `${Math.floor(percent)}%`;

_.eta = ({ total = NaN } = {}) => {
  let started;
  let lastCount;
  return ({ ratio = NaN, percent = NaN, count = NaN } = {}) => {
    if (!started) started = +new Date;
    const now = +new Date;
    const elapsed = now - started;
    if (!ratio) {
      if (percent) {
        ratio = percent / 100;
      } else if (total) {
        if (count !== undefined) {
          ratio = count / total;
        } else {
          lastCount++;
          ratio = lastCount / total;
        }
      } else {
        return { started, elapsed, remaining: Infinity, string: '∞' };
        throw new Error(`Need either: ratio|percent|count`);
      }
    }
    const estimatedTotal = elapsed / ratio;
    const remaining = estimatedTotal - elapsed;
    const string = _.prettyMs(remaining);
    return { started, elapsed, remaining, string };
  }
}

_.diffString = (a, b) => {
  const diff = a - b;
  const multiple = a / b;
  return _.toFixed(diff > 0 ? `${multiple}x` : _.percentString(multiple * 100));
}

_.toFixed = (n, d) => {
  if (n >= 100) return Math.floor(n);
  if (n >= 10) return Number(n.toFixed(d || 1));
  else return Number(n.toFixed(d || 2));
  // else if (n <= -10) Math.ceil(n)
}

_.pathFrom = (input, mods = {}) => {
  if (!input) throw new Error('Need an input');
  let output = input;
  for (const key in mods) {
    if (!(key in Path)) throw new Error(`'${key}' is not a valid Path attribute`);
    const attribute = Path[key](output);
    let mod = mods[key];
    if (typeof mod === 'function') mod = mod(attribute)
    output = output.replace(attribute, mod);
  }
  return output;
};



_.readdir = async (dir, { filter, map } = {}) => {
  dir = _.normalize(dir);
  let files = await fs.readdir(dir);
  files = files.map(f => _.normalize([dir, f]));
  if (map) files = files.map(map);
  if (filter) files = files.filter(filter);
  return files;
}
