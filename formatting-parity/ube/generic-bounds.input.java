class Sample<T extends Comparable<T>> extends Base<T> implements Runnable {
public <E extends Enum<E>> E enumValue(String column, Class<E> type, E fallback) { return fallback; }
<E extends Enum<E>> E enumValue() { return null; }
<T extends Number & Comparable<T>> T identity(T value) throws Exception {
return value;
}
java.util.List<? extends Number> numbers() { return null; }
public void run() {}
}
class Base<T> {}
interface Values<T extends Comparable<T>> extends Iterable<T> {}
