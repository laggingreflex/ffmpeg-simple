/**
 * Helper to ease generation of complex filter graph
 * Handles input/outputs automatically (no need to specify)
 * Example:
 * ```js
 * const complexFilter = new ComplexFilterGenerator()
 *
 * ```
 */

const arrify = x => Array.isArray(x) ? x : x === undefined ? [] : [x];
const flatten = (x, depth = Infinity) => arrify(x).flat(depth);
const randomString = () => Math.random().toString(36).substring(6);

class ComplexFilterGenerator {

  constructor(input) {
    this.complexFilter = [];
    this.firstInput = input;
  }
  push(filter) {
    if (typeof filter === 'string') {
      filter = { filter };
    } else {
      filter = { ...filter };
    }

    if (!filter.inputs && filter.inputs !== false) {
      if (this.lastOutput.length) {
        filter.inputs = this.lastOutput;
      } else if (this.firstInput) {
        filter.inputs = this.firstInput;
      }
    }
    if (filter.inputs) filter.inputs = arrify(flatten(flatten(filter.inputs).map(i => this.constructor.processInput(i)))).filter(Boolean);
    if (!filter.inputs || (filter.inputs && !filter.inputs.length)) {
      delete filter.inputs;
    }

    if (!filter.outputs) {
      filter.outputs = [`${filter.filter}-${randomString()}`]
    }

    this.complexFilter.push(filter);
    return filter.outputs;
  }

  *[Symbol.iterator]() {
    for (const item of this.complexFilter) {
      if (item) yield item;
    }
  }
  get lastFilter() {
    return this.complexFilter[this.complexFilter.length - 1];
  }
  get lastOutput() {
    const { lastFilter } = this;
    if (lastFilter) return lastFilter.outputs;
    else return [];
  }
  static processInput(input) {
    if (input instanceof this) {
      if (input.lastOutput && input.lastOutput.length) {
        return input.lastOutput;
      } else if ('firstInput' in input) {
        return this.processInput(input.firstInput);
      }
    } else if (Array.isArray(input)) {
      return input.map(i => this.processInput(i));
    } else if (typeof input === 'string') {
      return input;
    } else if (typeof input === 'number') {
      return String(input);
    } else {
      console.error(input);
      throw new Error('Invalid input');
    }
  }

  static flatten(...filters) {
    return flatten(flatten(filters).map(filter => {
      if (filter instanceof this) {
        return [...filter];
      } else return filter;
    }));
  }

  static lastOutput(...filters) {
    return flatten(flatten(filters).map(filter => {
      if (filter instanceof this) {
        return filter.lastOutput;
      } else return filter;
    }));
  }

};
