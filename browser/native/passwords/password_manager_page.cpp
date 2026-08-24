#include "password_manager_page.h"
#include "credential_vault_manager.h"

#include <QClipboard>
#include <QCheckBox>
#include <QComboBox>
#include <QAction>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QFileDialog>
#include <QGridLayout>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPushButton>
#include <QPainter>
#include <QPainterPath>
#include <QPixmap>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QScrollArea>
#include <QScrollBar>
#include <QSettings>
#include <QSpinBox>
#include <QStandardPaths>
#include <QStyle>
#include <QStyleOptionButton>
#include <QTimer>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>
#include <QFutureWatcher>
#include <QtConcurrentRun>

#include <algorithm>

namespace {
class ConsentCheckBox final : public QCheckBox {
 public:
  using QCheckBox::QCheckBox;

 protected:
  void paintEvent(QPaintEvent *) override {
    QStyleOptionButton option;
    initStyleOption(&option);
    QPainter painter(this);

    const QRect indicator = style()->subElementRect(QStyle::SE_CheckBoxIndicator, &option, this).adjusted(1, 1, -1, -1);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setPen(QPen(isChecked() ? QColor(QStringLiteral("#16b8e7")) : QColor(QStringLiteral("#64748b")), 1.2));
    painter.setBrush(isChecked() ? QColor(QStringLiteral("#16b8e7")) : QColor(QStringLiteral("#080d15")));
    painter.drawRoundedRect(indicator, 4, 4);
    if (isChecked()) {
      QPen tick(QColor(QStringLiteral("#062632"))); tick.setWidthF(2.1); tick.setCapStyle(Qt::RoundCap); tick.setJoinStyle(Qt::RoundJoin);
      painter.setPen(tick); painter.setBrush(Qt::NoBrush);
      QPainterPath path; path.moveTo(indicator.left() + 3.3, indicator.center().y()); path.lineTo(indicator.left() + 6.8, indicator.bottom() - 3.5); path.lineTo(indicator.right() - 3.0, indicator.top() + 3.5);
      painter.drawPath(path);
    }
    painter.setPen(isEnabled() ? palette().color(QPalette::WindowText) : palette().color(QPalette::Disabled, QPalette::WindowText));
    const QRect textRect(indicator.right() + 8, 0, width() - indicator.right() - 8, height());
    painter.drawText(textRect, Qt::AlignVCenter | Qt::TextWordWrap, text());
  }
};

QIcon passwordVisibilityIcon(bool visible) {
  QPixmap pixmap(20, 20); pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap); painter.setRenderHint(QPainter::Antialiasing);
  QPen pen(QColor(QStringLiteral("#c7d2df"))); pen.setWidthF(1.7); painter.setPen(pen); painter.setBrush(Qt::NoBrush);
  painter.drawEllipse(QRectF(3, 6, 14, 8)); painter.setBrush(QColor(QStringLiteral("#c7d2df"))); painter.drawEllipse(QRectF(8, 8, 4, 4));
  if (!visible) { QPen slash(QColor(QStringLiteral("#c7d2df"))); slash.setWidthF(2.0); painter.setPen(slash); painter.drawLine(QPointF(3.5, 3.5), QPointF(16.5, 16.5)); }
  return QIcon(pixmap);
}

QLineEdit *passwordField(QWidget *parent) {
  auto *field = new QLineEdit(parent); field->setEchoMode(QLineEdit::Password); field->setMaxLength(256);
  auto *toggle = field->addAction(passwordVisibilityIcon(false), QLineEdit::TrailingPosition);
  toggle->setToolTip(QStringLiteral("Parolayı göster"));
  QObject::connect(toggle, &QAction::triggered, field, [field, toggle] {
    const bool makeVisible = field->echoMode() != QLineEdit::Normal;
    field->setEchoMode(makeVisible ? QLineEdit::Normal : QLineEdit::Password);
    toggle->setIcon(passwordVisibilityIcon(makeVisible));
    toggle->setToolTip(makeVisible ? QStringLiteral("Parolayı gizle") : QStringLiteral("Parolayı göster"));
    if (makeVisible) QTimer::singleShot(15000, field, [field, toggle] {
      if (field->echoMode() != QLineEdit::Normal) return;
      field->setEchoMode(QLineEdit::Password); toggle->setIcon(passwordVisibilityIcon(false)); toggle->setToolTip(QStringLiteral("Parolayı göster"));
    });
  });
  return field;
}
QString generatedPassword(int length, bool upper, bool lower, bool digits, bool symbols) {
  QString alphabet;
  if (upper) alphabet += QStringLiteral("ABCDEFGHJKLMNPQRSTUVWXYZ");
  if (lower) alphabet += QStringLiteral("abcdefghijkmnopqrstuvwxyz");
  if (digits) alphabet += QStringLiteral("23456789");
  if (symbols) alphabet += QStringLiteral("!@#$%^&*_-+=");
  if (alphabet.isEmpty()) return {};
  QString result; result.reserve(length);
  auto *rng = QRandomGenerator::system();
  for (int index = 0; index < length; ++index) result += alphabet.at(rng->bounded(alphabet.size()));
  return result;
}

QIcon platformIconForOrigin(const QString &origin, const QString &iconPngBase64 = {}) {
  const QByteArray imageData = QByteArray::fromBase64(iconPngBase64.toLatin1());
  QPixmap websiteIcon;
  if (!imageData.isEmpty() && imageData.size() <= 12 * 1024 && websiteIcon.loadFromData(imageData, "PNG")) {
    return QIcon(websiteIcon.scaled(32, 32, Qt::KeepAspectRatio, Qt::SmoothTransformation));
  }
  const QString host = QUrl(origin).host().toLower();
  QString label = host.section(QLatin1Char('.'), 0, 0).left(2).toUpper();
  QColor background;
  if (host.endsWith(QStringLiteral("github.com"))) { label = QStringLiteral("GH"); background = QColor(QStringLiteral("#24292f")); }
  else if (host.endsWith(QStringLiteral("google.com"))) { label = QStringLiteral("G"); background = QColor(QStringLiteral("#4285f4")); }
  else if (host.endsWith(QStringLiteral("microsoft.com"))) { label = QStringLiteral("M"); background = QColor(QStringLiteral("#00a4ef")); }
  else if (host.endsWith(QStringLiteral("ebay.com"))) { label = QStringLiteral("e"); background = QColor(QStringLiteral("#e53238")); }
  else { background = QColor::fromHsv(int(qHash(host) % 360), 150, 185); }
  QPixmap pixmap(32, 32); pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap); painter.setRenderHint(QPainter::Antialiasing);
  painter.setPen(Qt::NoPen); painter.setBrush(background); painter.drawEllipse(QRectF(2, 2, 28, 28));
  QFont font = painter.font(); font.setBold(true); font.setPixelSize(label.size() > 1 ? 10 : 17); painter.setFont(font);
  painter.setPen(Qt::white); painter.drawText(pixmap.rect(), Qt::AlignCenter, label);
  return QIcon(pixmap);
}

QIcon recordActionIcon(const QString &action) {
  QPixmap pixmap(18, 18); pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap); painter.setRenderHint(QPainter::Antialiasing);
  QPen pen(QColor(QStringLiteral("#d6e1ec"))); pen.setWidthF(1.6); painter.setPen(pen); painter.setBrush(Qt::NoBrush);
  if (action == QLatin1String("edit")) {
    painter.drawLine(QPointF(4, 13.5), QPointF(13.5, 4)); painter.drawLine(QPointF(4, 13.5), QPointF(7.2, 12.7));
    painter.drawLine(QPointF(12.2, 3.8), QPointF(14.2, 5.8));
  } else if (action == QLatin1String("copy")) {
    painter.drawRoundedRect(QRectF(6, 3, 8, 10), 1.2, 1.2); painter.drawRoundedRect(QRectF(3, 6, 8, 9), 1.2, 1.2);
  } else {
    painter.drawLine(QPointF(4, 5), QPointF(14, 5)); painter.drawLine(QPointF(7, 3), QPointF(11, 3)); painter.drawRoundedRect(QRectF(5.5, 5.5, 7, 9), 1.0, 1.0);
    painter.drawLine(QPointF(8, 7.5), QPointF(8, 12.5)); painter.drawLine(QPointF(11, 7.5), QPointF(11, 12.5));
  }
  return QIcon(pixmap);
}
}

PasswordManagerPage::PasswordManagerPage(CredentialVaultManager *vault, QWidget *parent) : QWidget(parent), vault_(vault) {
  setObjectName(QStringLiteral("password-manager-page"));
  setStyleSheet(QStringLiteral(R"(
    #password-manager-page { background:#090d15; color:#eef4ff; }
    #password-manager-page QLabel { color:#cbd5e1; }
    #password-manager-page QLineEdit, #password-manager-page QComboBox { background:#080d15; color:#ffffff; border:1px solid #334155; border-radius:10px; min-height:38px; padding:0 12px; }
    #password-manager-page QLineEdit:focus, #password-manager-page QComboBox:focus { border:1px solid #38bdf8; }
    #password-manager-page QPushButton { border:0; border-radius:10px; background:#16b8e7; color:#00131b; font-weight:700; min-height:38px; padding:0 14px; }
    #password-manager-page QPushButton:hover { background:#41c8ef; }
    #password-manager-page QPushButton:disabled { background:#16b8e7; color:#00131b; opacity:.45; }
    #password-manager-page QPushButton[ghost="true"] { background:#243044; color:#e5edf8; }
    #password-manager-page QPushButton[ghost="true"]:hover { background:#33435b; }
    #password-manager-page QPushButton[danger="true"] { background:#7f1d1d; color:#ffffff; }
    #password-manager-page QPushButton[danger="true"]:hover { background:#9f2929; }
    #password-manager-page QCheckBox { color:#cbd5e1; spacing:8px; }
    #password-manager-page QCheckBox:disabled { color:#65717c; }
    #password-manager-page QCheckBox::indicator { width:17px; height:17px; border:1px solid #64748b; border-radius:4px; background:#080d15; }
    #password-manager-page QCheckBox::indicator:checked { background:#16b8e7; border-color:#16b8e7; }
    #password-manager-page QListWidget { background:#101722; border:1px solid #29364a; border-radius:12px; outline:0; padding:4px; color:#94a3b8; }
    #password-manager-page QListWidget::item { border-radius:9px; }
    #password-manager-page QToolButton { color:#7dd3fc; background:transparent; border:0; font-weight:600; text-align:left; padding:3px 0; }
  )"));
  auto *layout = new QVBoxLayout(this); layout->setContentsMargins(36, 28, 36, 28); layout->setSpacing(14);
  auto *kicker = new QLabel(QStringLiteral("ArDali güvenli kasa"), this); kicker->setStyleSheet("color:#aebdcd;font-size:12px;font-weight:600;"); layout->addWidget(kicker);
  auto *title = new QLabel(QStringLiteral("Şifre Yöneticisi"), this); title->setStyleSheet("font-size:24px;font-weight:700;color:#eaf2ff;"); layout->addWidget(title);
  status_ = new QLabel(this); status_->setWordWrap(true); layout->addWidget(status_);
  connect(vault_, &CredentialVaultManager::lockStateChanged, this, &PasswordManagerPage::refresh);
  connect(vault_, &CredentialVaultManager::changed, this, &PasswordManagerPage::refresh);
  refresh();
}

void PasswordManagerPage::refresh() {
  while (auto *item = layout()->takeAt(3)) { if (item->widget()) item->widget()->deleteLater(); delete item; }
  if (!vault_->exists()) {
    if (!QSettings().value(QStringLiteral("browser/passwords/experimentalConsentAccepted"), false).toBool()) showConsent(); else showSetup();
  } else if (vault_->isLocked()) showUnlock(); else showRecords();
}
void PasswordManagerPage::showConsent() {
  status_->setText(QStringLiteral("ArDali güvenli kasa"));
  auto *card = new QFrame(this); card->setObjectName(QStringLiteral("vault-consent-card")); card->setMinimumWidth(660); card->setMaximumWidth(720); card->setStyleSheet(QStringLiteral("QFrame#vault-consent-card{background:#241b0d;border:1px solid #a16207;border-radius:18px;}"));
  auto *content = new QVBoxLayout(card); content->setContentsMargins(28, 24, 28, 24); content->setSpacing(13);
  auto *badge = new QLabel(QStringLiteral("DENEYSEL"), card); badge->setStyleSheet(QStringLiteral("color:#ffd54a;font-weight:700;border:1px solid #d69a00;border-radius:10px;padding:3px 9px;")); content->addWidget(badge, 0, Qt::AlignLeft);
  auto *heading = new QLabel(QStringLiteral("Parola Yöneticisini Etkinleştir"), card); heading->setStyleSheet(QStringLiteral("font-size:21px;font-weight:700;color:#eef4fb;")); content->addWidget(heading);
  auto *body = new QLabel(QStringLiteral("Bu isteğe bağlı özellik, yalnızca onayladığınız kimlik bilgilerini bu cihazdaki şifrelenmiş kasada saklar. Özellik devre dışıyken oturum açma alanları işlenmez."), card); body->setWordWrap(true); content->addWidget(body);
  auto *noticeToggle = new QToolButton(card); noticeToggle->setObjectName(QStringLiteral("vault-notice-toggle")); noticeToggle->setText(QStringLiteral("Ayrıntılı bildirimi kaydırarak okuyun")); noticeToggle->setCheckable(true); noticeToggle->setChecked(true); noticeToggle->setToolButtonStyle(Qt::ToolButtonTextBesideIcon); noticeToggle->setArrowType(Qt::DownArrow); content->addWidget(noticeToggle, 0, Qt::AlignLeft);
  auto *noticeScroll = new QScrollArea(card); noticeScroll->setObjectName(QStringLiteral("vault-notice-scroll")); noticeScroll->setWidgetResizable(true); noticeScroll->setFixedHeight(205); noticeScroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff); noticeScroll->setStyleSheet(QStringLiteral("QScrollArea{background:#17202b;border:1px solid #34506b;border-radius:10px;} QScrollBar:vertical{width:12px;background:#101722;border-radius:5px;} QScrollBar::handle:vertical{min-height:28px;background:#4a6580;border-radius:5px;}"));
  auto *notice = new QLabel(QStringLiteral("Yerel parola kasası bildirimi\n\n• Kaydedilen site adresleri, kullanıcı adları ve parolalar yalnızca bu cihazdaki şifrelenmiş kasada tutulur.\n\n• Kayıtlar ArDali sunucusuna gönderilmez ve cihazlar arasında eşitlenmez.\n\n• Kasa, ana parolanızla korunur. Ana parolanızı unutursanız kayıtlar kurtarılamaz; geliştirici arka kapısı yoktur.\n\n• Hiçbir güvenlik sistemi mutlak koruma sağlamaz. Zararlı yazılım veya ele geçirilmiş bir cihaz risk oluşturmaya devam eder.\n\n• Özelliği istediğiniz zaman devre dışı bırakabilirsiniz. Devre dışı bırakmak kasayı silmez; kalıcı silme için ayrıca onay istenir.\n\n• Bu deneysel özellik bankacılık, devlet, birincil e-posta veya kripto hesapları için henüz önerilmez."), noticeScroll); notice->setObjectName(QStringLiteral("vault-notice")); notice->setWordWrap(true); notice->setAlignment(Qt::AlignTop | Qt::AlignLeft); notice->setStyleSheet(QStringLiteral("border:0;padding:12px;color:#e5d5b5;")); noticeScroll->setWidget(notice); content->addWidget(noticeScroll);
  connect(noticeToggle, &QToolButton::toggled, card, [noticeToggle, noticeScroll](bool shown) { noticeToggle->setArrowType(shown ? Qt::DownArrow : Qt::RightArrow); noticeScroll->setVisible(shown); });
  content->addSpacing(10);
  auto *noticeCheck = new ConsentCheckBox(QStringLiteral("Parola Yöneticisi bildirimini okudum ve anladım."), card); noticeCheck->setObjectName(QStringLiteral("vault-notice-acknowledgement")); noticeCheck->setEnabled(false); noticeCheck->setToolTip(QStringLiteral("Önce ayrıntılı bildirimin sonuna kadar kaydırın."));
  auto *activationCheck = new ConsentCheckBox(QStringLiteral("Kimlik bilgilerimin bu cihazdaki şifreli kasada işlenmesini ve özelliğin etkinleştirilmesini istiyorum."), card); activationCheck->setObjectName(QStringLiteral("vault-activation-acknowledgement")); activationCheck->setEnabled(false); activationCheck->setToolTip(QStringLiteral("Önce ayrıntılı bildirimin sonuna kadar kaydırın.")); content->addWidget(noticeCheck); content->addWidget(activationCheck);
  auto *buttons = new QHBoxLayout; auto *enable = new QPushButton(QStringLiteral("Deneysel özelliği etkinleştir"), card); enable->setObjectName(QStringLiteral("vault-enable-experimental")); enable->setEnabled(false); auto *later = new QPushButton(QStringLiteral("Şimdi değil"), card); later->setProperty("ghost", true); buttons->addWidget(enable); buttons->addWidget(later); buttons->addStretch(); content->addItem(buttons);
  const auto updateEnable = [noticeCheck, activationCheck, noticeScroll, enable] { enable->setEnabled(noticeCheck->isChecked() && activationCheck->isChecked() && noticeScroll->property("readToEnd").toBool()); };
  connect(noticeCheck, &QCheckBox::toggled, card, updateEnable); connect(activationCheck, &QCheckBox::toggled, card, updateEnable);
  connect(noticeScroll->verticalScrollBar(), &QScrollBar::valueChanged, card, [noticeScroll, noticeCheck, activationCheck, updateEnable](int position) { if (position >= noticeScroll->verticalScrollBar()->maximum() && !noticeScroll->property("readToEnd").toBool()) { noticeScroll->setProperty("readToEnd", true); noticeCheck->setEnabled(true); activationCheck->setEnabled(true); noticeCheck->setToolTip({}); activationCheck->setToolTip({}); updateEnable(); } });
  connect(enable, &QPushButton::clicked, this, [this] { QSettings().setValue(QStringLiteral("browser/passwords/experimentalConsentAccepted"), true); statusMessage_ = QStringLiteral("Deneysel özellik etkinleştirildi."); refresh(); });
  connect(later, &QPushButton::clicked, this, [this] { status_->setText(QStringLiteral("Parola Yöneticisi etkinleştirilmedi.")); });
  static_cast<QVBoxLayout *>(layout())->addWidget(card, 0, Qt::AlignHCenter); layout()->addItem(new QSpacerItem(1, 1, QSizePolicy::Minimum, QSizePolicy::Expanding));
}
void PasswordManagerPage::showSetup() {
  status_->setText(statusMessage_.isEmpty() ? QStringLiteral("Deneysel özellik etkinleştirildi.") : statusMessage_);
  auto *card = new QFrame(this); card->setObjectName(QStringLiteral("vault-setup-card")); card->setStyleSheet(QStringLiteral("QFrame#vault-setup-card{background:#101722;border:1px solid #29364a;border-radius:18px;}")); card->setMaximumWidth(520); auto *form = new QVBoxLayout(card); form->setContentsMargins(22, 22, 22, 22); form->setSpacing(10);
  auto *heading = new QLabel(QStringLiteral("Yeni bir kasa oluştur"), card); heading->setStyleSheet(QStringLiteral("font-size:21px;font-weight:700;color:#eef4fb;")); form->addWidget(heading); form->addWidget(new QLabel(QStringLiteral("Kasaya bir ad verin ve güçlü bir ana şifre seçin. Unutulan kayıtlar kurtarılamaz."), card));
  form->addWidget(new QLabel(QStringLiteral("Kasa adı"), card)); auto *vaultName = new QLineEdit(card); vaultName->setObjectName(QStringLiteral("vault-name")); vaultName->setMaxLength(64); vaultName->setText(QStringLiteral("Kişisel")); form->addWidget(vaultName);
  form->addWidget(new QLabel(QStringLiteral("Ana şifre"), card)); master_ = passwordField(card); master_->setObjectName(QStringLiteral("vault-master-password")); master_->setPlaceholderText(QStringLiteral("Ana şifre")); form->addWidget(master_);
  auto *rules = new QGridLayout; rules->setHorizontalSpacing(24); rules->setVerticalSpacing(7); const QStringList ruleTexts{QStringLiteral("En az 12 karakter"), QStringLiteral("En az bir küçük harf"), QStringLiteral("En az bir büyük harf"), QStringLiteral("En az bir sayı"), QStringLiteral("En az bir sembol")}; const QStringList ruleNames{QStringLiteral("length"), QStringLiteral("lower"), QStringLiteral("upper"), QStringLiteral("number"), QStringLiteral("symbol")}; QVector<QLabel *> ruleLabels; for (int i = 0; i < ruleTexts.size(); ++i) { auto *label = new QLabel(QStringLiteral("●  %1").arg(ruleTexts.at(i)), card); label->setObjectName(QStringLiteral("vault-rule-%1").arg(ruleNames.at(i))); label->setStyleSheet(QStringLiteral("color:#f87171;font-size:12px;")); ruleLabels.append(label); rules->addWidget(label, i / 2, i % 2); } form->addLayout(rules);
  form->addWidget(new QLabel(QStringLiteral("Şifreyi onayla"), card)); confirm_ = passwordField(card); confirm_->setObjectName(QStringLiteral("vault-confirm-password")); confirm_->setPlaceholderText(QStringLiteral("Şifreyi onayla")); form->addWidget(confirm_); auto *match = new QLabel(QStringLiteral("•  Şifreler eşleşmiyor"), card); match->setObjectName(QStringLiteral("vault-password-match")); match->setStyleSheet(QStringLiteral("color:#ff7676;")); form->addWidget(match);
  auto *create = new QPushButton(QStringLiteral("Kasayı oluştur"), card); create->setObjectName(QStringLiteral("vault-create")); create->setEnabled(false); form->addWidget(create, 0, Qt::AlignLeft);
  const auto validate = [this, ruleLabels, match, create] { const QString value = master_->text(); const QVector<bool> checks{value.size() >= 12, value.contains(QRegularExpression(QStringLiteral("[a-z]"))), value.contains(QRegularExpression(QStringLiteral("[A-Z]"))), value.contains(QRegularExpression(QStringLiteral("[0-9]"))), value.contains(QRegularExpression(QStringLiteral("[^A-Za-z0-9\\s]")))}; for (int i = 0; i < checks.size(); ++i) ruleLabels.at(i)->setStyleSheet(checks.at(i) ? QStringLiteral("color:#55e69a;") : QStringLiteral("color:#ff7676;")); const bool same = !value.isEmpty() && value == confirm_->text(); match->setText(same ? QStringLiteral("•  Şifreler eşleşiyor") : QStringLiteral("•  Şifreler eşleşmiyor")); match->setStyleSheet(same ? QStringLiteral("color:#55e69a;") : QStringLiteral("color:#ff7676;")); create->setEnabled(std::all_of(checks.cbegin(), checks.cend(), [](bool ok) { return ok; }) && same); };
  connect(master_, &QLineEdit::textChanged, card, validate); connect(confirm_, &QLineEdit::textChanged, card, validate);
  connect(create, &QPushButton::clicked, this, [this, create, vaultName] { const QString p = master_->text(); const QString name = vaultName->text(); master_->clear(); confirm_->clear(); create->setEnabled(false); status_->setText(QStringLiteral("Kasa güvenli biçimde oluşturuluyor…")); auto *watcher = new QFutureWatcher<bool>(this); connect(watcher, &QFutureWatcher<bool>::finished, this, [this, create, watcher] { const bool ok = watcher->result(); watcher->deleteLater(); create->setEnabled(true); if (ok) { statusMessage_ = QStringLiteral("Kasa oluşturuldu."); refresh(); } else status_->setText(QStringLiteral("Kasa oluşturulamadı: %1").arg(vault_->lastError())); }); watcher->setFuture(QtConcurrent::run([vault = vault_, name, p] { return vault->createVault(name, p); })); });
  static_cast<QVBoxLayout *>(layout())->addWidget(card, 0, Qt::AlignHCenter); layout()->addItem(new QSpacerItem(1, 1, QSizePolicy::Minimum, QSizePolicy::Expanding));
}
void PasswordManagerPage::showUnlock() {
  status_->setText(QStringLiteral("Kasa kilitli. Tarayıcı her başlangıçta kilitli başlar; web sayfaları kasa API’sine erişemez.")); auto *panel = new QWidget(this); auto *form = new QFormLayout(panel); auto *vaultPicker = new QComboBox(panel); for (const VaultMetadata &item : vault_->vaults()) vaultPicker->addItem(item.name + (item.locked ? QStringLiteral(" · kilitli") : QStringLiteral(" · açık")), item.id); vaultPicker->setCurrentIndex(vaultPicker->findData(vault_->activeVaultId())); master_ = passwordField(panel); auto *unlock = new QPushButton(QStringLiteral("Kasayı aç"), panel); form->addRow(QStringLiteral("Kasa"), vaultPicker); form->addRow(QStringLiteral("Ana parola"), master_); form->addRow({}, unlock); layout()->addWidget(panel); layout()->addItem(new QSpacerItem(1, 1, QSizePolicy::Minimum, QSizePolicy::Expanding));
  connect(vaultPicker, &QComboBox::currentIndexChanged, this, [this, vaultPicker](int) { vault_->setActiveVault(vaultPicker->currentData().toString()); });
  connect(unlock, &QPushButton::clicked, this, [this, unlock] { const QString p = master_->text(); master_->clear(); unlock->setEnabled(false); status_->setText(QStringLiteral("Ana parola doğrulanıyor…")); auto *watcher = new QFutureWatcher<bool>(this); connect(watcher, &QFutureWatcher<bool>::finished, this, [this, unlock, watcher] { const bool ok = watcher->result(); watcher->deleteLater(); unlock->setEnabled(true); if (!ok) status_->setText(QStringLiteral("Kasa açılamadı: %1").arg(vault_->lastError())); }); watcher->setFuture(QtConcurrent::run([vault = vault_, p] { return vault->unlock(p); })); }); connect(master_, &QLineEdit::returnPressed, unlock, &QPushButton::click);
}
void PasswordManagerPage::showRecords() {
  status_->setText(statusMessage_.isEmpty() ? QStringLiteral("Kasa açık. Parolalar varsayılan olarak maskelidir.") : statusMessage_);
  // Keep every manager control in one owned widget.  A vault-created signal can
  // refresh this page while creation completes; a single subtree prevents a
  // partially laid out toolbar or footer during that first paint.
  auto *manager = new QWidget(this);
  manager->setObjectName(QStringLiteral("vault-manager"));
  auto *managerLayout = new QVBoxLayout(manager);
  managerLayout->setContentsMargins(0, 0, 0, 0);
  managerLayout->setSpacing(14);
  auto *actions = new QHBoxLayout;
  auto *vaultPicker = new QComboBox(manager); vaultPicker->setObjectName(QStringLiteral("vault-picker"));
  for (const VaultMetadata &item : vault_->vaults()) vaultPicker->addItem(item.name + (item.locked ? QStringLiteral(" · kilitli") : QStringLiteral(" · açık")), item.id);
  vaultPicker->setCurrentIndex(vaultPicker->findData(vault_->activeVaultId()));
  search_ = new QLineEdit(manager); search_->setObjectName(QStringLiteral("vault-search")); search_->setPlaceholderText(QStringLiteral("Site veya kullanıcı adı ara"));
  auto *toggleUsernames = new QPushButton(passwordVisibilityIcon(usernamesVisible_), {}, manager); toggleUsernames->setObjectName(QStringLiteral("vault-toggle-usernames")); toggleUsernames->setFixedWidth(34); toggleUsernames->setToolTip(usernamesVisible_ ? QStringLiteral("Kullanıcı adlarını maskele") : QStringLiteral("Kullanıcı adlarını göster"));
  auto *add = new QPushButton(QStringLiteral("Kimlik bilgisi ekle"), manager); add->setObjectName(QStringLiteral("vault-add-credential"));
  auto *newVault = new QPushButton(QStringLiteral("Yeni kasa"), manager); newVault->setObjectName(QStringLiteral("vault-create-new")); newVault->setProperty("ghost", true);
  auto *changeMaster = new QPushButton(QStringLiteral("Ana parolayı değiştir"), manager);
  auto *autoLock = new QComboBox(manager); autoLock->setObjectName(QStringLiteral("vault-auto-lock")); autoLock->setToolTip(QStringLiteral("Kasa otomatik kilit süresi"));
  autoLock->addItem(QStringLiteral("1 dk"), 60000); autoLock->addItem(QStringLiteral("5 dk"), 5 * 60000); autoLock->addItem(QStringLiteral("15 dk"), 15 * 60000); autoLock->addItem(QStringLiteral("30 dk"), 30 * 60000); autoLock->setCurrentIndex(autoLock->findData(vault_->autoLockTimeoutMs()));
  auto *lock = new QPushButton(QStringLiteral("Kasayı kilitle"), manager); lock->setObjectName(QStringLiteral("vault-lock"));
  actions->addWidget(vaultPicker); actions->addWidget(search_, 1); actions->addWidget(toggleUsernames); actions->addWidget(add); actions->addWidget(newVault); actions->addWidget(lock); managerLayout->addLayout(actions);
  records_ = new QListWidget(manager); records_->setMinimumHeight(280); records_->setSelectionMode(QAbstractItemView::NoSelection); records_->setFocusPolicy(Qt::NoFocus); managerLayout->addWidget(records_, 1);
  const auto populate = [this] {
    if (!records_) return;
    const QString q = search_->text().trimmed(); records_->clear();
    for (const CredentialMetadata &meta : vault_->list()) {
      if (!q.isEmpty() && !meta.origin.contains(q, Qt::CaseInsensitive) && !meta.username.contains(q, Qt::CaseInsensitive)) continue;
      auto *item = new QListWidgetItem(records_); item->setData(Qt::UserRole, meta.id); item->setToolTip(QStringLiteral("%1\nGüncellendi: %2").arg(meta.origin, meta.updatedAt.toLocalTime().toString(Qt::ISODate)));
      auto *card = new QWidget(records_); auto *cardLayout = new QHBoxLayout(card); cardLayout->setContentsMargins(10, 7, 8, 7); cardLayout->setSpacing(10);
      auto *platform = new QLabel(card); platform->setPixmap(platformIconForOrigin(meta.origin, meta.iconPngBase64).pixmap(32, 32)); platform->setFixedSize(32, 32); cardLayout->addWidget(platform);
      auto *details = new QWidget(card); auto *detailsLayout = new QVBoxLayout(details); detailsLayout->setContentsMargins(0, 0, 0, 0); detailsLayout->setSpacing(2);
      auto *origin = new QLabel(meta.origin, details); origin->setStyleSheet(QStringLiteral("font-weight:600;color:#eef5fb;"));
      const QString displayedUsername = usernamesVisible_ ? meta.username : QString(std::max(8, int(meta.username.size())), QChar(0x2022));
      auto *username = new QLabel(displayedUsername, details); username->setStyleSheet(QStringLiteral("color:#c7d2df;")); detailsLayout->addWidget(origin); detailsLayout->addWidget(username); cardLayout->addWidget(details, 1);
      auto *edit = new QPushButton(recordActionIcon(QStringLiteral("edit")), QStringLiteral("Düzenle"), card); edit->setToolTip(QStringLiteral("Kimlik bilgisini düzenle"));
      auto *copy = new QPushButton(recordActionIcon(QStringLiteral("copy")), QStringLiteral("Kopyala"), card); copy->setToolTip(QStringLiteral("Parolayı kopyala"));
      auto *remove = new QPushButton(recordActionIcon(QStringLiteral("delete")), QStringLiteral("Sil"), card); remove->setToolTip(QStringLiteral("Kimlik bilgisini sil")); remove->setProperty("danger", true);
      cardLayout->addWidget(edit); cardLayout->addWidget(copy); cardLayout->addWidget(remove);
      item->setSizeHint(card->sizeHint()); records_->setItemWidget(item, card);
      connect(edit, &QPushButton::clicked, this, [this, id = meta.id] { addCredential(id); });
      connect(copy, &QPushButton::clicked, this, [this, id = meta.id] { copyPassword(id); });
      connect(remove, &QPushButton::clicked, this, [this, id = meta.id] { if (QMessageBox::question(this, QStringLiteral("Şifre Yöneticisi"), QStringLiteral("Seçili kimlik bilgisi silinsin mi?"), QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes && !vault_->remove(id)) QMessageBox::warning(this, QStringLiteral("Şifre Yöneticisi"), vault_->lastError()); });
    }
    if (!records_->count()) { auto *empty = new QListWidgetItem(QStringLiteral("Kimlik bilgisi bulunamadı."), records_); empty->setFlags(Qt::NoItemFlags); }
  };
  auto *separator = new QFrame(manager); separator->setFrameShape(QFrame::HLine); separator->setStyleSheet(QStringLiteral("color:#3a4858;")); managerLayout->addWidget(separator);
  auto *securityActions = new QHBoxLayout; auto *autoLockLabel = new QLabel(QStringLiteral("Otomatik Kilit"), manager); auto *backup = new QPushButton(QStringLiteral("Yedek al"), manager); backup->setObjectName(QStringLiteral("vault-export-backup")); backup->setProperty("ghost", true); auto *restore = new QPushButton(QStringLiteral("Yedekten içe aktar"), manager); restore->setObjectName(QStringLiteral("vault-import-backup")); restore->setProperty("ghost", true); auto *disable = new QPushButton(QStringLiteral("Özelliği devre dışı bırak"), manager); disable->setObjectName(QStringLiteral("vault-disable")); disable->setProperty("ghost", true); auto *reset = new QPushButton(QStringLiteral("Kasayı sıfırla"), manager); reset->setObjectName(QStringLiteral("vault-reset")); reset->setProperty("danger", true); auto *deleteVault = new QPushButton(QStringLiteral("Kasayı sil"), manager); deleteVault->setObjectName(QStringLiteral("vault-delete")); deleteVault->setProperty("danger", true); changeMaster->setObjectName(QStringLiteral("vault-change-master")); changeMaster->setProperty("ghost", true); securityActions->addWidget(autoLockLabel); securityActions->addWidget(autoLock); securityActions->addStretch(); securityActions->addWidget(backup); securityActions->addWidget(restore); securityActions->addWidget(disable); securityActions->addWidget(changeMaster); securityActions->addWidget(reset); securityActions->addWidget(deleteVault); managerLayout->addLayout(securityActions);
  static_cast<QVBoxLayout *>(layout())->addWidget(manager, 1);
  populate(); connect(vaultPicker, &QComboBox::currentIndexChanged, this, [this, vaultPicker](int) { vault_->setActiveVault(vaultPicker->currentData().toString()); }); connect(search_, &QLineEdit::textChanged, this, populate); connect(toggleUsernames, &QPushButton::clicked, this, [this, toggleUsernames, populate] { usernamesVisible_ = !usernamesVisible_; toggleUsernames->setIcon(passwordVisibilityIcon(usernamesVisible_)); toggleUsernames->setToolTip(usernamesVisible_ ? QStringLiteral("Kullanıcı adlarını maskele") : QStringLiteral("Kullanıcı adlarını göster")); populate(); }); connect(add, &QPushButton::clicked, this, [this] { addCredential(); }); connect(newVault, &QPushButton::clicked, this, &PasswordManagerPage::createVault); connect(lock, &QPushButton::clicked, vault_, &CredentialVaultManager::lock);
  connect(autoLock, &QComboBox::currentIndexChanged, this, [this, autoLock](int) { vault_->setAutoLockTimeoutMs(autoLock->currentData().toInt()); });
  connect(changeMaster, &QPushButton::clicked, this, [this, changeMaster] { bool ok = false; const QString current = QInputDialog::getText(this, QStringLiteral("Ana parolayı değiştir"), QStringLiteral("Mevcut ana parola"), QLineEdit::Password, {}, &ok); if (!ok || current.isEmpty()) return; const QString next = QInputDialog::getText(this, QStringLiteral("Ana parolayı değiştir"), QStringLiteral("Yeni ana parola"), QLineEdit::Password, {}, &ok); if (!ok || next.isEmpty()) return; changeMaster->setEnabled(false); status_->setText(QStringLiteral("Ana parola değiştiriliyor…")); auto *watcher = new QFutureWatcher<bool>(this); connect(watcher, &QFutureWatcher<bool>::finished, this, [this, changeMaster, watcher] { const bool changed = watcher->result(); watcher->deleteLater(); changeMaster->setEnabled(true); status_->setText(changed ? QStringLiteral("Ana parola değiştirildi.") : QStringLiteral("Ana parola değiştirilemedi: %1").arg(vault_->lastError())); }); watcher->setFuture(QtConcurrent::run([vault = vault_, current, next] { return vault->changeMasterPassword(current, next); })); });
  connect(disable, &QPushButton::clicked, this, [this] { if (QMessageBox::question(this, QStringLiteral("Şifre Yöneticisi"), QStringLiteral("Özellik devre dışı bırakılsın mı? Kasa silinmez."), QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes) { vault_->lock(); QSettings().setValue(QStringLiteral("browser/passwords/experimentalConsentAccepted"), false); refresh(); } });
  connect(backup, &QPushButton::clicked, this, &PasswordManagerPage::exportBackup); connect(restore, &QPushButton::clicked, this, &PasswordManagerPage::importBackup);
  connect(reset, &QPushButton::clicked, this, [this] { if (QMessageBox::warning(this, QStringLiteral("Kasayı sıfırla"), QStringLiteral("Bu kasadaki tüm kayıtlı kimlik bilgileri kalıcı olarak silinecek. Kasa adı ve ana parola korunur."), QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes && !vault_->clearActiveVault()) QMessageBox::warning(this, QStringLiteral("Şifre Yöneticisi"), vault_->lastError()); });
  connect(deleteVault, &QPushButton::clicked, this, [this] { const bool lastVault = vault_->vaults().size() == 1; const QString warning = lastVault ? QStringLiteral("Son kasa ve içindeki tüm kayıtlar kalıcı olarak silinecek. Sonraki açılışta güvenlik koşullarını yeniden onaylamanız istenecek.") : QStringLiteral("Seçili kasa ve içindeki tüm kayıtlar kalıcı olarak silinecek."); if (QMessageBox::warning(this, QStringLiteral("Kasayı sil"), warning, QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes) { if (!vault_->deleteVault(vault_->activeVaultId())) QMessageBox::warning(this, QStringLiteral("Şifre Yöneticisi"), vault_->lastError()); else if (lastVault) { QSettings().setValue(QStringLiteral("browser/passwords/experimentalConsentAccepted"), false); statusMessage_ = QStringLiteral("Kasa silindi. Yeni kasa için koşulları yeniden onaylayın."); refresh(); } } });
}
void PasswordManagerPage::createVault() {
  bool ok = false;
  const QString name = QInputDialog::getText(this, QStringLiteral("Yeni kasa"), QStringLiteral("Kasa adı"), QLineEdit::Normal, {}, &ok).trimmed();
  if (!ok || name.isEmpty()) return;
  const QString master = QInputDialog::getText(this, QStringLiteral("Yeni kasa"), QStringLiteral("Ana parola"), QLineEdit::Password, {}, &ok);
  if (!ok || master.isEmpty()) return;
  const QString confirmation = QInputDialog::getText(this, QStringLiteral("Yeni kasa"), QStringLiteral("Ana parolayı onayla"), QLineEdit::Password, {}, &ok);
  if (!ok || master != confirmation || !CredentialVaultManager::isStrongMasterPassword(master)) { QMessageBox::warning(this, QStringLiteral("Yeni kasa"), QStringLiteral("Ana parola güvenlik kurallarını karşılamıyor veya eşleşmiyor.")); return; }
  if (!vault_->createVault(name, master)) QMessageBox::warning(this, QStringLiteral("Yeni kasa"), vault_->lastError());
}
void PasswordManagerPage::exportBackup() {
  QString path = QFileDialog::getSaveFileName(this, QStringLiteral("Şifre kasalarını yedekle"), QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + QStringLiteral("/ardali-kasalar.ardali-vault-backup"), QStringLiteral("ArDali kasa yedeği (*.ardali-vault-backup)"));
  if (path.isEmpty()) return;
  if (!path.endsWith(QStringLiteral(".ardali-vault-backup"), Qt::CaseInsensitive)) path += QStringLiteral(".ardali-vault-backup");
  bool ok = false; const QString password = QInputDialog::getText(this, QStringLiteral("Yedek parolası"), QStringLiteral("Yedek dosyası için güçlü parola"), QLineEdit::Password, {}, &ok); if (!ok || password.isEmpty()) return;
  const QString confirmation = QInputDialog::getText(this, QStringLiteral("Yedek parolası"), QStringLiteral("Yedek parolasını onayla"), QLineEdit::Password, {}, &ok); if (!ok || password != confirmation || !CredentialVaultManager::isStrongMasterPassword(password)) { QMessageBox::warning(this, QStringLiteral("Yedek al"), QStringLiteral("Yedek parolası güvenlik kurallarını karşılamıyor veya eşleşmiyor.")); return; }
  if (!vault_->exportBackup(path, password)) QMessageBox::warning(this, QStringLiteral("Yedek al"), vault_->lastError()); else status_->setText(QStringLiteral("Şifreli kasa yedeği oluşturuldu: %1").arg(path));
}
void PasswordManagerPage::importBackup() {
  const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Kasa yedeğini içe aktar"), QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation), QStringLiteral("ArDali kasa yedeği (*.ardali-vault-backup)")); if (path.isEmpty()) return;
  bool ok = false; const QString password = QInputDialog::getText(this, QStringLiteral("Yedekten içe aktar"), QStringLiteral("Yedek parolası"), QLineEdit::Password, {}, &ok); if (!ok || password.isEmpty()) return;
  QStringList imported; if (!vault_->importBackup(path, password, &imported)) QMessageBox::warning(this, QStringLiteral("Yedekten içe aktar"), vault_->lastError()); else statusMessage_ = QStringLiteral("Yedekten içe aktarılan kasalar: %1").arg(imported.join(QStringLiteral(", ")));
}
void PasswordManagerPage::addCredential(const QString &id) {
  if (vault_->isLocked()) return;
  QDialog dialog(this); dialog.setWindowTitle(id.isEmpty() ? QStringLiteral("Kimlik bilgisi ekle") : QStringLiteral("Kimlik bilgisini düzenle")); auto *form = new QFormLayout(&dialog); auto *origin = new QLineEdit(&dialog); auto *username = new QLineEdit(&dialog); auto *password = passwordField(&dialog); if (!id.isEmpty()) { CredentialSecret value; if (!vault_->reveal(id, &value)) return; origin->setText(value.origin); origin->setReadOnly(true); username->setText(value.username); password->setText(value.password); QTimer::singleShot(15000, password, &QLineEdit::clear); }
  auto *generator = new QWidget(&dialog); auto *generatorLayout = new QHBoxLayout(generator); generatorLayout->setContentsMargins(0, 0, 0, 0); auto *length = new QSpinBox(generator); length->setRange(8, 128); length->setValue(20); auto *upper = new QCheckBox(QStringLiteral("A-Z"), generator); auto *lower = new QCheckBox(QStringLiteral("a-z"), generator); auto *digits = new QCheckBox(QStringLiteral("0-9"), generator); auto *symbols = new QCheckBox(QStringLiteral("Semboller"), generator); upper->setChecked(true); lower->setChecked(true); digits->setChecked(true); symbols->setChecked(true); auto *generate = new QPushButton(QStringLiteral("Üret"), generator); generatorLayout->addWidget(length); generatorLayout->addWidget(upper); generatorLayout->addWidget(lower); generatorLayout->addWidget(digits); generatorLayout->addWidget(symbols); generatorLayout->addWidget(generate);
  form->addRow(QStringLiteral("HTTPS origin"), origin); form->addRow(QStringLiteral("Kullanıcı adı"), username); form->addRow(QStringLiteral("Parola"), password); form->addRow(QStringLiteral("Güvenli üretici"), generator); auto *buttons = new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Cancel, &dialog); form->addRow(buttons); connect(generate, &QPushButton::clicked, &dialog, [password, length, upper, lower, digits, symbols] { password->setText(generatedPassword(length->value(), upper->isChecked(), lower->isChecked(), digits->isChecked(), symbols->isChecked())); }); connect(buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept); connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject); if (dialog.exec() != QDialog::Accepted) return; bool update = false; const CredentialSecret candidate{origin->text(), username->text(), password->text(), {}}; const bool saved = id.isEmpty() ? vault_->save(candidate, &update) : vault_->update(id, candidate); password->clear(); if (!saved) QMessageBox::warning(this, QStringLiteral("Şifre Yöneticisi"), QStringLiteral("Kayıt başarısız: %1").arg(vault_->lastError()));
}
void PasswordManagerPage::copyPassword(const QString &id) { CredentialSecret secret; if (!vault_->reveal(id, &secret)) return; QClipboard *clipboard = QGuiApplication::clipboard(); clipboard->setText(secret.password); QTimer::singleShot(30000, this, [clipboard, value = secret.password] { if (clipboard->text() == value) clipboard->clear(); }); }
