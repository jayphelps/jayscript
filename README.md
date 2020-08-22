# JayScript

## Install

```bash
npm install jayscript -g
```

## Usage

Currently JayScript only supports function declarations that take no arguments and can only have return statements. The return statement must return either an integer, or a binary expression of addition.

##### example.js
```js
function main() {
  return 1 + 2;
}
```

```bash
jayscript example.js

    (module
     (type $none_=>_i32 (func (result i32)))
     (export "main" (func $0))
     (func $0 (result i32)
      (return
       (i32.add
        (i32.const 1)
        (i32.const 2)
       )
      )
     )
    )

```

### Options

If you want to optimize the Wasm output, you can pass the `-Oz` flag:

```bash
jayscript example.js

    (module
     (type $none_=>_i32 (func (result i32)))
     (export "main" (func $0))
     (func $0 (result i32)
      (i32.const 3)
     )
    )
```

## Notes

[This is just a joke.](https://twitter.com/_jayphelps/status/1296980153294368773) :shipit:
