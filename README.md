# ffmpeg-simple

**Work In Progress**

## Install

```
npm i [-g] ffmpeg-simple
```

## Usage

### CLI

```
ffmpeg-simple <file-to-convert> [opts..]
ffs <file> [opts..]
```

### Node

```js
const { ffmpeg, ffprobe, concat ... } = require('ffmpeg-simple')
```
```js
const { output, size, duration } = await ffmpeg({
  input: 'file.mp4',
  codec: 'hevc_nvenc',
  preset: 'slow',
  quality: 30,
  speed: 2,
  // audio: false,
  audioChannels: 1,
})
```
```js
const output = await concat({
  inputs: ['file1.mp4', 'file2.mp4', ...]
})
```


