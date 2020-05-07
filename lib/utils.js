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

_.constants = {
  size: {
    GB: 1024 * 1024 * 1024,
    MB: 1024 * 1024,
    KB: 1024,
  },
  duration: {
    days: 60 * 60 * 24,
    hours: 60 * 60,
    minutes: 60,
  },
};

_.normalize = (path, {
  cwd = _.defaults.cwd,
  homedir = _.defaults.homedir,
} = {}) => {
  if (Path.isAbsolute(path)) return path;
  if (path.startsWith('~')) return Path.join(homedir, path.substr(1));
  return Path.join(cwd, path);
}

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


_.stdoutLine = str => {
  process.stdout.clearLine();
  process.stdout.write(str);
  process.stdout.cursorTo(0);
}

_.prettyBytes = size => prettyBytes(size, {});
_.sizeString = size => {
  for (const unit in _.constants.size) {
    if (size > _.constants.size[unit]) {
      size /= _.constants.size[unit];
      return `${size.toFixed(0)} ${unit}`
    }
  }
  return `${size.toFixed(0)} b`;
};

_.durationString = duration => {
  if (!duration) return duration;
  for (const unit in _.constants.duration) {
    if (duration > _.constants.duration[unit]) {
      duration /= _.constants.duration[unit];
      return `${duration.toFixed(0)} ${unit}`;
    }
  }
  return `${duration.toFixed(0)} seconds`;
}

_.percentString = percent => `${Math.floor(percent)}%`;

_.eta = ({ total = NaN } = {}) => {
  let start;
  let lastCount;
  return ({ ratio = NaN, percent = NaN, count = NaN } = {}) => {
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
        return '?';
        throw new Error(`Need either: ratio|percent|count`);
      }
    }
    if (!start) start = +new Date;
    const now = +new Date;
    const passed = now - start;
    const estimatedTotal = passed / ratio;
    const remaining = estimatedTotal - passed;
    return _.durationString(remaining / 1000);
  }
}

_.unique = arr => Array.from(new Set(arr));

_.shorten = (string, length = 15) => {
  if (string.length < length) return string;
  // string = string.replace(/[\W]+/g, '')
  string = string.replace(/[ \[\]\(\),._-]+/g, '')
  if (string.length < length) return string;
  const prefix = string.substr(0, 9 * length / 10);
  const suffix = string.substr(-length / 10);
  return `${prefix}…${suffix}`;
}

_.joinPath = Path.join;

_.path = path => {
  path = _.normalize(path);
  const ext = Path.extname(path);
  const name = Path.basename(path, ext);
  const dir = Path.dirname(path);
  const shortDir = _.shorten(dir.replace(/[\/\\]+/g, '/'), 50);
  const shortName = _.shorten(name, 50);
  const short = `${shortDir}/${shortName}${ext}`
  return { dir, name, ext, path, short };
}

_.diffString = (a, b) => {
  const diff = a - b;
  const multiple = a / b;
  return diff > 0 ? `${multiple}x` : _.percentString(multiple * 100);
}

_.pathFrom = (input, mods = {}) => {
  if (!input) throw new Error('Need an input');
  let output = input;
  for (const key in mods) {
    if (!(key in Path)) throw new Error(`'${key}' is not a valid Path attribute`);
    const attribute = Path[key](output);
    output = output.replace(attribute, mods[key]);
  }
  return output;
}

