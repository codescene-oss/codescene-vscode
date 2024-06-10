The code has become too complex as it contains many conditional statements (e.g. if, for, while) across its implementation, leading to lower code health. Avoid adding more.

Code in the global scope that grows too complex is a sign that the design lacks abstractions. Consider encapsulating the complex constructs in named functions that can serve as higher-level abstractions of the concept.