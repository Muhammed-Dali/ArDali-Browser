# .dali Grammar (v0)

This is the first working grammar for the `.dali` audio DSL.

```ebnf
program      = { preset_decl } ;

preset_decl  = "preset" string "{" { section } "}" ;
section      = input_decl | output_decl | chain_decl | quality_decl ;

input_decl   = "input" ident ";" ;
output_decl  = "output" ident ";" ;

chain_decl   = "chain" "{" { effect_stmt } "}" ;
effect_stmt  = ident { param_assign } ";" ;
param_assign = ident "=" literal ;

quality_decl = "quality" "{" { quality_stmt } "}" ;
quality_stmt = ident literal ";" ;

literal      = number [ unit ] | string | ident ;
unit         = "hz" | "ms" | "db" | "x" ;
```

Notes:
- Units are optional and currently interpreted by the backend compiler.
- Unknown effects are surfaced as compiler errors.
- `quality` is currently metadata + guard rails for runtime configuration.
