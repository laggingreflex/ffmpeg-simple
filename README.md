# ffmpeg-simple

Makes using ffmpeg in NodeJS (and via CLI) simpler with a bunch of frequently used helpers (cut, concat, speed, rotate) and simpler params passing (input, filters)

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
  treble: true, // or a number for gain (true == 5) -> -af "treble=g=5"
  voice: true,  // enhances speech clarity -> -af "equalizer=f=3000:t=h:width=2000:g=4,highshelf=f=8000:g=3"
})
```
```js
const output = await concat({
  inputs: ['file1.mp4', 'file2.mp4', ...]
})
```
