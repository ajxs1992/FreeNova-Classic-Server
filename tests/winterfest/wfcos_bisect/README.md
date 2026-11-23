# wfcos_bisect — narrowing an amxxpc `std::bad_alloc`

`amxxpc 1.10.0.5467` (the compiler in this tree) crashes with
`std::bad_alloc` on some sources instead of reporting anything. It did so on
`winterfest_cosmetics.sma`.

**Both faults are found and fixed** — `docs/WINTERFEST-COSMETICS.md` §9 has the
account: a `'\t'` character constant (`error 027` + `undefined symbol t`) whose
error-recovery path throws `std::bad_alloc` when it sits inside a nested
`&&`/`||` expression, and, behind it, five undefined `fncosmetics_*` natives from
a missing include. The no-argument run below prints `OK` now; if it ever prints
`CRASH` again, §9.4 is the method to use and §9.1 is the first thing to grep for
(`grep -n "\\\\" *.sma` — a backslash escape has no business in a Pawn source).

Deleting a function is useless as a probe: the missing symbol is a compile error,
the back end never runs, and the crash disappears for the wrong reason. This
script **stubs bodies instead** (`{ return 0; }`), so the file still compiles
cleanly and only the real code under test changes.

```sh
# every body real -> the real result (must print OK)
python3 tests/winterfest/wfcos_bisect/bisect.py

# keep only functions 1..24 real, stub the rest
python3 tests/winterfest/wfcos_bisect/bisect.py 1-24

# one function only (the fastest way to find a single poison)
python3 tests/winterfest/wfcos_bisect/bisect.py 37
```

It prints `OK` or `CRASH` for the subset and the last lines of the compiler
output. It uses the same `i386/debian:bookworm-slim` image and the same
`amxxpc` as `tools/compile-plugins.sh`, writes only into
`tools/build/probe/` (gitignored), and never touches the live tree.

Function numbering comes from the order of the definitions in
`winterfest_cosmetics.sma`; run it with no argument and read the file to map a
number back to a name.

## What this harness cannot see

Two traps that cost hours on this file and that a stub-bisect will not explain on
its own (both are in `docs/WINTERFEST-COSMETICS.md` §9.4):

* the crash happens **while recovering from an error**, so any edit that changes
  whether the compiler has to recover moves it. "It moved when I touched it" is
  not evidence of a size budget;
* a **global variable used before its declaration** also ends in `std::bad_alloc`,
  with no error and no line number. If adding one `g_x++` crashes a file that was
  clean a second ago, look at where `g_x` is declared before believing anything.
