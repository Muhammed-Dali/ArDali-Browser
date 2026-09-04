#include "browser_policy.h"

#include <QUrl>

#include <iostream>

int main() {
  QString error;
  const BrowserPolicy policy = BrowserPolicy::load(QStringLiteral(ARDALI_BROWSER_POLICY_PATH), &error);
  if (!policy.isValid() || !policy.allowsNavigation(QUrl("https://example.com"))
      || !policy.allowsNavigation(QUrl("ardali://newtab"))
      || policy.allowsNavigation(QUrl("ardali://attacker-controlled"))
      || policy.allowsNavigation(QUrl("file:///etc/passwd"))
      || !policy.blocksUnrequestedPopups() || !policy.allowsDownloadPrompt()
      || !policy.allowsSessionRestore()) {
    std::cerr << "browser policy validation failed: " << error.toStdString() << '\n';
    return 1;
  }
  std::cout << "DALI browser policy enforcement: ok\n";
  return 0;
}
