The functions in this file have too many primitive types (e.g. int, double, float) in their function argument lists. Using many primitive types lead to the code smell *Primitive Obsession*. Avoid adding more primitive arguments.

Primitive obsession indicates a missing domain language, leading to a number of issues. First, primitive types typically require separate validation logic in the application code. Second, primitive types can lead to fragile code as they don't constrain the value range in the way a domain type could. Introducing domain specific types simplifies the code and improves its robustness.


## Example

Code that uses a high degree of built-in primitives such as integers, strings, floats, lacks a domain language that encapsulates the validation and semantics of function arguments. Primitive Obsession has several consequences:

- In a statically typed language, the compiler will detect less erroneous assignments.
- Security impact since the possible value range of a variable/argument isn't restricted.

Here is an example of code with too many primitive types as arguments:
```java
public class PrimitiveObsessionExample {
	public JsonNode search(String query, Integer pages, Integer pageSize) {
		return httpClient.get(String.format("%s?q=%s&pages=%d&pageSize=%d",
					baseUrl,
					query,
					pages == null ? 10 : pages,
					pageSize == null ? 10 : pages));
	}
}
```

## Solution

Primitive Obsession indicates a missing domain language. Introduce data types that encapsulate the details and constraints of your domain. For example, instead of `int userId`, consider `User clicked`. Working with the previous example, we can make an attempt at straightening out the code:

```java
public class PrimitiveObsessionExample {
	public JsonNode search(SearchRequest request) {
		return httpClient.get(request.getUrl());
	}
}
```
