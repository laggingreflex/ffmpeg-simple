const OS = require('os');
const Path = require('path');
const fs = require('fs-extra');

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

_.readdir = async (dir = '.', {
  bail = _.defaults.bail,
  cwd = _.defaults.cwd,
  homedir = _.defaults.homedir,
  start = +new Date,
  timeout = _.defaults.timeout,
  count = 0,
  limit = _.defaults.limit,
  filter = null,
} = {}) => {
  const duration = +new Date - start;
  dir = _.normalize(dir, { cwd, homedir });
  if (filter && dir.match(filter)) {
    console.log('Skipping', dir);
    return { files: [], duration, count };
  }
  console.log('Reading', dir);
  const errors = [];
  try {
    if (duration >= timeout) {
      console.error(duration);
      throw _.constants.errors.timeout;
    }
    if (count >= limit) {
      console.error(count);
      throw _.constants.errors.limit;
    }

    // console.debug('Reading:', dir, { duration, count });
    let files = await fs.readdir(dir);
    files = files.filter(f => f !== '.');
    files = files.filter(f => f !== '..');
    files = files.filter(f => !(filter && f.match(filter)));
    files = files.map(f => Path.join(dir, f));

    files = files.map(file => {
      try {
        return { file, stats: _.stat(file) };
      } catch (error) {
        errors.push(error);
      }
    }).filter(Boolean);

    count += files.length;

    files = await Promise.all(files.map(async ({ file, stats }) => {
      try {
        // const stats = fs.statSync(file);
        if (stats.isDirectory) {
          const r = await _.readdir(file, { bail, cwd, homedir, start, timeout, count });
          count += r.files.length;
          errors.push(...r.errors);
          return r.files;
        }
      } catch (error) {
        if (bail || error === _.constants.errors.timeout || error === _.constants.errors.limit) {
          throw error;
        }
        errors.push({ error, file });
      }

      return { file, stats };
    }));

    files = files.flat();

    return { files, errors, duration, count };
  } catch (error) {
    errors.push(error);
    return { files: [], errors, duration, count };
  }
}

_.normalize = (path, {
  cwd = _.defaults.cwd,
  homedir = _.defaults.homedir,
} = {}) => {
  if (Path.isAbsolute(path)) return path;
  if (path.startsWith('~')) return Path.join(homedir, path.substr(1));
  return Path.join(cwd, path);
}

_.expandFnProps = object => {
  const expanded = {};
  for (const key of Object.keys(object)) {
    let value = object[key];
    if (typeof value === 'function') {
      // console.log(`Expanding:`, key);
      value = value.call(object);
    }
    expanded[key] = value;
  }
  return expanded;
}

_.stat = file => {
  const stats = fs.statSync(file);
  return {
    size: stats.size,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    atime: stats.atimeMs,
    mtime: stats.mtimeMs,
    ctime: stats.ctimeMs,
  }
}

_.sort = (cb = i => i, cb2 = i => i) => (a, b) => cb2(cb(a) - cb(b));

_.define = (object, props) => {
  for (const key in props) {
    Object.defineProperty(object, key, {
      value: props[key],
      enumerable: false,
    })
  }
}

_.arrify = x => Array.isArray(x) ? x : x === undefined ? [] : [x];

_.tmpFile = (...path) => {
  if (!path.length) path.push(String(+new Date));
  return Path.join(_.defaults.tmpdir, ...path);
}

_.try = (...fns) => {
  return recurse();

  function recurse(i = 0, errors = []) {
    const fn = fns[i];
    if (!fn) {
      const error = errors.pop();
      error.errors = errors;
      throw error;
    }
    try {
      const result = fn();
      if (result && result.then) {
        return result.catch(error => {
          return recurse(i + 1, [...errors, error]);
        });
      } else return result;
    } catch (error) {
      return recurse(i + 1, [...errors, error]);
    }
  }
}

_.replaceFile = async (toReplace, replaceWith) => {
  // console.log(`Replacing "${toReplace}" -> with "${replaceWith}"`);
  const bkp = toReplace + '.bkp';
  // console.log(`Backing up "${toReplace}" to "${bkp}"`);
  await fs.rename(toReplace, bkp);
  // console.log(`Backed up "${toReplace}" to "${bkp}"`);
  try {
    // console.log(`Moving "${replaceWith}" -> to "${toReplace}"`);
    await fs.move(replaceWith, toReplace);
    // console.log(`Moved "${replaceWith}" -> to "${toReplace}"`);
    // await _.try(
    //   // () => fs.rename(replaceWith, toReplace),
    //   () => fs.move(replaceWith, toReplace),
    // );
  } catch (error) {
    // console.error(error.message);
    // console.log(`Restoring Backup "${bkp}" to "${toReplace}"`);
    await fs.rename(bkp, toReplace);
    throw error;
  }
  // console.log('Removing "${toReplace}"');
  await fs.remove(bkp);
  // console.log('Removed "${toReplace}"');
}

_.stdoutLine = str => {
  process.stdout.clearLine();
  process.stdout.write(str);
  process.stdout.cursorTo(0);
}

_.sizeString = size => {
  for (const unit in constants.size) {
    if (size > constants.size[unit]) {
      size /= constants.size[unit];
      return `${size.toFixed(0)} ${unit}`
    }
  }
  return `${size.toFixed(0)} b`;
};

_.durationString = duration => {
  if (!duration) return duration;
  for (const unit in constants.duration) {
    if (duration > constants.duration[unit]) {
      duration /= constants.duration[unit];
      return `${duration.toFixed(0)} ${unit}`;
    }
  }
  return `${duration.toFixed(0)} seconds`;
}

_.percentString = percent => {
  percent = Number(percent);
  let string;
  if (percent < 10) {
    percent = Number(percent.toFixed(1));
    string = `${percent.toFixed(1)}%`;
  } else {
    percent = parseInt(percent);
    string = `${percent}%`;
  }
  return string;
}

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
