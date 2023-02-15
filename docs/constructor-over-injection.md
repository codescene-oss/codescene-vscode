# Constructor Over-Injection

This constructor has too many arguments, indicating an object with low cohesion or missing function argument abstraction. Avoid adding more arguments.

Beyond a certain threshold, many constructor arguments indicate either a unit with low cohesion or an injection of dependencies at the wrong abstraction level.Remediate this issue by either a) splitting the class if it has too many responsibilities, or b) by introducing an abstraction (class, record, struct, etc.) which encapsulates the arguments. 