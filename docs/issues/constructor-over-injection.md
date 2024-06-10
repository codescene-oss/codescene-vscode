This constructor has too many arguments, indicating an object with low cohesion or missing function argument abstraction. Avoid adding more arguments. Remediate this issue by one of:

- Splitting the class if it has too many responsibilities.
- Introducing an abstraction (class, record, struct, etc.) which encapsulates the arguments. 

## Solution

There are multiple ways of addressing constructor over-injection:

- Sometimes you can introduce 
[FACADE services](https://en.wikipedia.org/wiki/Facade_pattern) that encapsulate lower-level dependencies.
- In many cases, Constructor Over-Injection is a symptom of a deeper problem. 
Make sure to investigate the root cause, and get some inspiration and examples from 
[Mark Seemann's article on the issue](https://blog.ploeh.dk/2018/08/27/on-constructor-over-injection/).



