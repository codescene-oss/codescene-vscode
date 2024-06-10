The Bumpy Road code smell is a function that contains multiple chunks of nested conditional logic. Just like a bumpy road slows down your driving, a bumpy road in code presents an obstacle to comprehension.

Fundamentally, a bumpy code road represents a lack of encapsulation which becomes an obstacle to comprehension. Worse, in imperative languages there’s also an increased risk for feature entanglement, which tends to lead to complex state management.

## Example

Here is an example of code that uses multiple chunks of nested conditional logic:
```java
public class BumpyRoadExample {
	public void processDirectory(String path) {
		// Find all files matching "data<number>.csv".
		List<String> files = new ArrayList<String>();
		File dir = new File(path);
		for (File file : dir.listFiles()) {
			if (file.isFile() && file.getName().matches("data\\d+\\.csv")) {
				files.add(file.getAbsolutePath());
			}
		}

		// Concatenate all the files into one
		StringBuilder sb = new StringBuilder();
		for (File file : files) {
			try (BufferedReader br = new BufferedReader(new FileReader(file))) {
				String line = br.readLine();
				while (line != null) {
					sb.append(line);
					line = br.readLine();
				}
			}
		}

		// Write the concatenated file to disk
		try (BufferedWriter bw = new BufferedWriter(new FileWriter("data.csv"))) {
			bw.write(sb.toString());
		}
	}
}
```

When inspecting bumpy code roads, we follow a set of simple rules to classify the severity of the code smell:

- The deeper the nested conditional logic of each bump, the higher the tax on our working memory.
- The more bumps we find, the more expensive it is to refactor as each bump represents a missing abstraction.
- The larger each bump – that is, the more lines of code it spans – the harder it is to build up a mental model of the function.


## Solution

Working with the previous example, and the idea that each bump might represent some missing abstraction, we can make an attempt at straightening out the code:

```java
public class BumpyRoadExample {
	public void processDirectory(String path) {
		List<String> paths = FileUtils.findFiles(path, "data\\d+\\.csv");

		String data = FileUtils.concatenateFiles(paths);

		// Write the concatenated file to disk
		try (BufferedWriter bw = new BufferedWriter(new FileWriter("data.csv"))) {
			bw.write(sb.toString());
		}
	}
}
```

In this case we were able to express the bumps in terms of more general functions that we able to place elsewhere. This enables re-use and makes the code easier to understand. We could even eliminate the comments as they now became superfluous.