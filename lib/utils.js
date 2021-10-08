const OS = require('os');
const Path = require('path');
const fs = require('fs-extra');
const prettyBytes = require('pretty-bytes');
const prettyMs = require('pretty-ms');
const throat = require('throat');

const _ = exports;

_.Error = class extends Error {
  constructor(message, details) {
    super(message);
    Object.assign(this, details);
  }
  log(verbose = false) {
    if (verbose) {
      console.error(this.message, this?.error?.stack ?? this?.stack ?? this)
    } else {
      console.error(this.message)
    }
  }
};

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

_.delay = delay => new Promise(r => setTimeout(r, delay));

_.defer = () => {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}

_.stdoutLine = (str, opts = {}) => {
  if (opts.trunc !== false) {
    str = str.slice(0, process.stdout.columns - 1);
  }
  process.stdout.clearLine();
  process.stdout.write(str);
  process.stdout.cursorTo(0);
};

_.safeInteger = n => Math.min(n || 0, Number.MAX_SAFE_INTEGER);
_.prettyMs = (ms, opts) => prettyMs(_.safeInteger(ms), { ...opts });
_.prettyS = (s, opts) => _.prettyMs(s * 1000, { ...opts });
_.humanDuration = ms => {
  if (typeof ms !== 'number') ms = Number(ms);
  if (ms < 0) return '−' + _.humanDuration(ms * -1);
  if (!isFinite(ms)) return '∞';
  if (ms < 1000 /*       1 second  */ ) return ms.toFixed(0) + '㎳';
  if (ms < 10000 /*     10 seconds */ ) return (ms / 1000 /*     1 second */ ).toFixed(1) + 's';
  if (ms < 60000 /*      1 minute  */ ) return (ms / 1000 /*     1 second */ ).toFixed(0) + 's';
  if (ms < 600000 /*    10 minutes */ ) return (ms / 60000 /*    1 minute */ ).toFixed(1) + 'm';
  if (ms < 3600000 /*    1 hour    */ ) return (ms / 60000 /*    1 minute */ ).toFixed(0) + 'm';
  if (ms < 36000000 /*  10 hours   */ ) return (ms / 3600000 /*  1 hour   */ ).toFixed(1) + 'hrs';
  if (ms < 86400000 /*   1 day     */ ) return (ms / 3600000 /*  1 hour   */ ).toFixed(0) + 'hrs';
  if (ms < 864000000 /* 10 days    */ ) return (ms / 86400000 /* 1 day    */ ).toFixed(1) + ' days';
  return (ms / 86400000).toFixed(0) + ' days';
};
_.humanSize = bytes => {
  if (typeof bytes !== 'number') bytes = Number(bytes);
  if (bytes < 0) return '−' + _.humanSize(bytes * -1);
  if (!isFinite(bytes)) return '∞';
  if (bytes < (10 * 1024) /*      10㎅ */ ) return (bytes / 1024 /*          1 ㎅ */ ).toFixed(1) + '㎅';
  if (bytes < (1024 ** 2) /*      1㎆  */ ) return (bytes / 1024 /*          1 ㎅ */ ).toFixed(0) + '㎅';
  if (bytes < (10 * 1024 ** 2) /* 10㎆ */ ) return (bytes / 1024 ** 2 /*     1 ㎆ */ ).toFixed(1) + '㎆';
  if (bytes < (1024 ** 3) /*      1㎇  */ ) return (bytes / 1024 ** 2 /*     1 ㎆ */ ).toFixed(0) + '㎆';
  if (bytes < (10 * 1024 ** 3) /* 10㎇ */ ) return (bytes / 1024 ** 3 /*     1 ㎇ */ ).toFixed(1) + '㎇';
  return (bytes / 1024 ** 3).toFixed(0) + '㎇';
};
_.prettyBytes = (size, opts) => prettyBytes(_.safeInteger(size), { ...opts });

_.toFixed = (num, fractionDigits = 1) => Number((num || 0).toFixed(fractionDigits));
_.minmax = (num, min = 0, max = Infinity) => Math.min(Math.max(min, num || 0), max);
_.ratio = ratio => _.minmax(ratio, -1, 1);
_.percent = (ratio, precision = 0) => {
  let percent = _.ratio(ratio) * 100;
  if ((precision === 1 || precision === true) && (-10 < percent || percent < 10)) {
    percent = _.toFixed(percent);
  } else if (!precision || (precision === 1 && (percent <= -10 || 10 <= percent))) {
    percent = percent > 0 ? Math.floor(percent) : Math.ceil(percent);
  } else {
    percent = _.toFixed(percent, precision);
  }
  return percent;
};


_.percentString = percent => `${Math.floor(percent)}%`;

_.eta = (opts = {}) => {
  if (typeof opts === 'number') opts = { total: opts };
  const { total } = opts;
  let started;
  let lastCount = 0;
  return ({ ratio, percent, count } = {}) => {
    if (!started) started = +new Date;
    const now = +new Date;
    const elapsed = _.minmax(now - started, 0);
    if (!ratio) {
      if (percent) {
        ratio = percent / 100;
      } else if (total) {
        ratio = 0;
        if (count !== undefined) {
          ratio = count / total;
          percent = _.percent(ratio);
        } else {
          lastCount++;
          ratio = lastCount / total;
          percent = _.percent(ratio);
        }
      } else {
        ratio = 0;
        return { started, percent, count: lastCount, total, elapsed, remaining: Infinity, string: '∞' };
      }
    }
    if (!ratio) ratio = 0;
    ratio = _.ratio(ratio);
    if (!percent) percent = _.percent(ratio);
    const estimatedTotal = _.minmax(elapsed / ratio);
    const remaining = _.minmax(estimatedTotal - elapsed);
    const message = `${percent}% ETA: ${_.humanDuration(remaining)} Elapsed: ${_.humanDuration(elapsed)}`;
    return { started, count: lastCount, total, percent, ratio, elapsed, remaining, message };
  }
};

_.diffString = (a, b) => {
  const diff = a - b;
  const multiple = a / b;
  return diff > 0 ? `${_.toFixed(multiple)}x` : _.percentString(multiple * 100);
}

_.toFixed = (n, d) => {
  n = parseFloat(String(n));
  if (n >= 100) return Math.floor(n);
  if (n >= 10) return Number(n.toFixed(d || 1));
  else return Number(n.toFixed(d || 2));
  // else if (n <= -10) Math.ceil(n)
};

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

_.throat = fn => throat(OS.cpus().length, fn);
_.promiseMap = (array, fn, opts) => Promise.all(array.map(_.throat(async (...args) => {
  try {
    return await fn(...args);
  } catch (error) {
    console.error(error);
    if (error && opts?.halt !== false) throw error;
    else return { args, error };
  }
})));

_.promiseMapEta = (array, fn, opts) => {
  const eta = _.eta(array.length);
  return _.promiseMap(array, async (item, i) => {
    try {
      return await fn(item, i);
    } finally {
      // const now = new Date;
      const currentProgress = eta();
      if (currentProgress.elapsed >= 5000) {
        (opts?.log || _.stdoutLine)?.(eta().message);
      }
    }
  }, opts);
};

_.sort = (array, key, descending) => array.sort((a, b) => {
  if (key?.key) {
    [{ key, descending }] = [key];
  }
  if (typeof key === 'string') {
    if (key.startsWith('!')) {
      key = key.substring(1);
      descending = true;
    }
    a = a[key];
    b = b[key];
  } else if (typeof key === 'function') {
    a = key(a);
    b = key(b);
  }
  let ag = a > b;
  let bg = b > a;
  if (descending) {
    [ag, bg] = [bg, ag];
  }
  if (ag) return 1;
  else if (bg) return -1;
  else return 0;
});

_.dedupe = array => Array.from(new Set(array));
