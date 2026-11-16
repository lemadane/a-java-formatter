public class ProductController {
  @PostMapping
  @PreAuthorize("hasAuthority(@securityConstant.queryScope {'GET_ADDRESS'})")
  public ResponseEntity<ProductResponse> create(
      @RequestBody
      @Validated
      CreateProductRequest request) {
    final var product = productService.create(request);
    final var location =
        URI.create(
          "/api/products/api/products/api/products/" + product.id());
    return ResponseEntity.created(location)
        .body(product);
  }
}
