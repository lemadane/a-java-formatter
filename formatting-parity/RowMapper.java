public class RowMapper {
    void mapRows() {
        resultSet.forEach((Row row) -> products.add(this.mapRow(row)));
    }
}
