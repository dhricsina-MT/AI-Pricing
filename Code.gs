function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Parking Rate Comparison')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
