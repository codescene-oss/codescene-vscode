Cohesion is calculated using the LCOM4 metric. Low cohesion means that the module/class has multiple **unrelated** responsibilities, doing too many things and breaking the Single Responsibility Principle.

With LCOM4, the functions inside a module are **related** if:

- they access the same data members, or
- they call each other.

A module with multiple responsibilities is harder to understand and more risky to change since there's a risk for unexpected feature interactions. Refactor low cohesion files by splitting them into cohesive units, one unit per responsibility.