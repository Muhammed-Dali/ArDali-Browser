#ifdef NDEBUG
#undef NDEBUG
#endif

#include <QApplication>
#include <QEventLoop>
#include <QElapsedTimer>
#include <QTimer>
#include <QTemporaryDir>
#include <QSettings>
#include <QLineEdit>
#include <QCompleter>
#include <QAbstractItemView>
#include <QJsonArray>
#include <QJsonDocument>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QGuiApplication>
#include <QScreen>
#include <QKeyEvent>

#include <cassert>
#include <cmath>
#include <iostream>

#include "browser_window.h"
#include "downloads/download_toolbar_ui.h"
#include "ardali_blocker_service.h"
#include "new_tab_scheme.h"
#include "search_suggestion_service.h"
#include "suggestion_test_transport.h"

static void wait(int ms)
{
    QEventLoop loop;
    QTimer::singleShot(ms, &loop, &QEventLoop::quit);
    loop.exec();
}

static QVariant js(QWebEnginePage *page, const QString &code)
{
    QVariant result;
    QEventLoop loop;

    page->runJavaScript(
        code,
        [&](const QVariant &v) {
            result = v;
            loop.quit();
        });

    QTimer::singleShot(5000, &loop, &QEventLoop::quit);
    loop.exec();

    return result;
}

static bool waitForJs(
    QWebEnginePage *page,
    const QString &condition,
    int timeoutMs = 5000)
{
    QElapsedTimer timer;
    timer.start();

    do {
        if (js(page, condition).toBool())
            return true;

        wait(50);
    } while (timer.elapsed() < timeoutMs);

    return false;
}

static void key(QWidget *widget, int code)
{
    QKeyEvent press(
        QEvent::KeyPress,
        code,
        Qt::NoModifier);

    QKeyEvent release(
        QEvent::KeyRelease,
        code,
        Qt::NoModifier);

    QApplication::sendEvent(widget, &press);
    QApplication::sendEvent(widget, &release);
}

int main(int argc, char **argv)
{
    registerArdaliUrlSchemes();

    QApplication app(argc, argv);
    app.setApplicationName("ArDaliPhase22dIntegration");
    app.setOrganizationName("ArDaliTest");

    QTemporaryDir root;

    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(
        QSettings::IniFormat,
        QSettings::UserScope,
        root.path());

    Network network;

    BrowserProfileService profile(
        root.path() + "/normal",
        nullptr,
        nullptr,
        false,
        &network);

    BrowserServices services;
    services.profile = profile.profile();
    services.profileService = &profile;

    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();
    window.addNewTab();

    wait(1000);

    // Unified native download bubble stays anchored and reuses one popup widget.
    auto *downloadButton =
        window.findChild<DownloadToolbarButton *>("mediaDownloadButton");

    auto *downloadPopup =
        window.findChild<DownloadPopup *>();

    assert(downloadButton && downloadPopup);

    downloadButton->setModelState(1, 0.0, false, false);
    assert(downloadButton->displayedProgress() == 0.0);

    downloadButton->setModelState(1, 50.0, false, false);
    assert(downloadButton->displayedProgress() == 50.0);

    downloadButton->setModelState(1, 100.0, false, false);
    assert(downloadButton->displayedProgress() == 100.0);

    downloadButton->setModelState(0, 0.0, false, false);

    downloadPopup->showAnchored(downloadButton, false);
    wait(30);

    assert(downloadPopup->isVisible());

    QPoint downloadEdge =
        downloadButton->mapToGlobal(
            QPoint(
                downloadButton->width(),
                downloadButton->height()));

    QRect available =
        QGuiApplication::primaryScreen()->availableGeometry();

    assert(
        available
            .adjusted(-1, -1, 1, 1)
            .contains(downloadPopup->geometry().topLeft()));

    assert(
        available
            .adjusted(-1, -1, 1, 1)
            .contains(downloadPopup->geometry().bottomRight()));

    if (available.contains(downloadEdge) &&
        downloadEdge.x() - downloadPopup->width() >= available.left()) {
        assert(
            std::abs(
                downloadPopup->geometry().right() -
                downloadEdge.x()) <= 2);
    }

    window.resize(920, 640);
    window.move(window.pos() + QPoint(7, 5));

    wait(30);

    downloadEdge =
        downloadButton->mapToGlobal(
            QPoint(
                downloadButton->width(),
                downloadButton->height()));

    assert(
        available
            .adjusted(-1, -1, 1, 1)
            .contains(downloadPopup->geometry().topLeft()));

    assert(
        available
            .adjusted(-1, -1, 1, 1)
            .contains(downloadPopup->geometry().bottomRight()));

    if (available.contains(downloadEdge) &&
        downloadEdge.x() - downloadPopup->width() >= available.left()) {
        assert(
            std::abs(
                downloadPopup->geometry().right() -
                downloadEdge.x()) <= 2);
    }

    for (int i = 0; i < 12; ++i) {
        downloadPopup->hide();
        downloadPopup->showAnchored(downloadButton, false);
    }

    assert(
        window.findChildren<DownloadPopup *>().size() == 1);

    downloadPopup->hide();

    auto *page = window.currentView()->page();

    assert(
        js(
            page,
            "typeof window.ardaliSuggestionBridge")
            .toString() == "function");

    assert(
        !page
             ->property("ardali-suggest-capability")
             .toString()
             .isEmpty());

    profile.toggleBookmark(
        QUrl("https://fixture.example/"));

    auto input = [&](const QString &text) {
        window.currentView()->setFocus(Qt::MouseFocusReason);

        wait(30);

        js(
            page,
            QString(
                "document.querySelector('#query').focus();"
                "document.querySelector('#query').value=%1[0];"
                "document.querySelector('#query').dispatchEvent("
                "new Event('input',{bubbles:true}));")
                .arg(
                    QString::fromUtf8(
                        QJsonDocument(
                            QJsonArray{text})
                            .toJson(
                                QJsonDocument::Compact))));
    };

    input("fixture");
    wait(400);

    assert(network.requests == 0);

    assert(
        js(
            page,
            "document.querySelectorAll('.suggestion-row').length>=2")
            .toBool());

    js(
        page,
        "document.querySelector('#query').dispatchEvent("
        "new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));");

    assert(
        js(
            page,
            "document.querySelector('#query').getAttribute("
            "'aria-activedescendant')")
            .toString() == "suggestion-0");

    js(
        page,
        "document.querySelector('#query').dispatchEvent("
        "new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");

    assert(
        js(
            page,
            "document.querySelector('#search-suggestions').hidden")
            .toBool());

    // Consent uses the native allowlisted bridge, not a separate localStorage key.
    js(
        page,
        "document.querySelector('#suggestions-toggle').checked=true;"
        "document.querySelector('#suggestions-toggle').dispatchEvent("
        "new Event('change'));");

    wait(100);

    assert(
        profile.searchSuggestions()->isEnabled());

    input("hav");
    wait(450);

    std::cerr
        << "bridge state: enabled="
        << profile.searchSuggestions()->isEnabled()
        << " nativeFocus="
        << window.currentView()->hasFocus()
        << " nativeId="
        << page->property("ardali-suggest-id").toInt()
        << " js="
        << js(
               page,
               "JSON.stringify({"
               "id:suggestionId,"
               "focus:document.hasFocus(),"
               "active:document.activeElement?.id,"
               "rows:document.querySelectorAll('.suggestion-row').length"
               "})")
               .toString()
               .toStdString()
        << std::endl;

    assert(network.requests > 0);

    const QString snapshotPath =
        qEnvironmentVariable(
            "ARDALI_PHASE22D_SNAPSHOT");

    if (!snapshotPath.isEmpty()) {
        assert(
            window.grab().save(snapshotPath));
    }

    assert(
        js(
            page,
            "Array.from(document.querySelectorAll('.suggestion-row'))"
            ".some(x=>x.textContent==='hava durumu')")
            .toBool());

    input("hava durumu");
    wait(450);

    assert(
        network.last.url().query().contains("hava durumu") ||
        network.last.url().toString().contains("hava durumu"));

    // Untrusted suggestion HTML is displayed as text, never parsed as markup.
    network.body =
        R"JSON(["markup",["<img src=x onerror=alert(1)>"]])JSON";

    input("markup");
    wait(450);

    assert(
        !js(
             page,
             "!!document.querySelector('.suggestion-row img[onerror]')")
             .toBool());

    js(
        page,
        "location.href='ardali://suggest?"
        "op=consent&enabled=false&cap=wrong'");

    wait(100);

    assert(
        profile.searchSuggestions()->isEnabled());

    profile.setSearchSuggestionsEnabled(false);

    const int before =
        network.requests;

    input("offline");
    wait(350);

    assert(
        network.requests == before);

    // Both surfaces use the same transport; the native completion model
    // retains types and local rows.
    auto *omnibox =
        window.findChild<QLineEdit *>("omnibox");

    if (!omnibox) {
        for (auto *edit :
             window.findChildren<QLineEdit *>()) {
            if (edit->completer()) {
                omnibox = edit;
                break;
            }
        }
    }

    assert(omnibox);

    profile.setSearchSuggestionsEnabled(true);

    network.body =
        R"(["hav",["hava","hava durumu"]])";

    omnibox->setFocus();
    omnibox->setText("hav");

    QMetaObject::invokeMethod(
        omnibox,
        "textEdited",
        Qt::DirectConnection,
        Q_ARG(QString, QString("hav")));

    wait(450);

    auto *completer =
        omnibox->completer();

    std::cerr
        << "omnibox focus="
        << omnibox->hasFocus()
        << " rows="
        << (completer
                ? completer->model()->rowCount()
                : -1)
        << " requests="
        << network.requests
        << " popup="
        << (completer &&
            completer->popup()->isVisible())
        << std::endl;

    assert(
        completer &&
        completer->model()->rowCount() >= 3);

    bool remote = false;

    for (int row = 0;
         row < completer->model()->rowCount();
         ++row) {
        remote |=
            completer
                ->model()
                ->index(row, 0)
                .data(Qt::UserRole + 2)
                .toString() == "remote";
    }

    assert(remote);

    const QModelIndex chosen =
        completer
            ->completionModel()
            ->index(2, 0);

    const QUrl selectedUrl =
        chosen
            .data(Qt::UserRole + 1)
            .toUrl();

    completer
        ->popup()
        ->setCurrentIndex(chosen);

    key(
        omnibox,
        Qt::Key_Return);

    wait(50);

    assert(
        page->requestedUrl() ==
        selectedUrl);

    page->triggerAction(
        QWebEnginePage::Stop);

    // A renderer changing history/reloading must not trigger the close-only policy.
    profile
        .blockerService()
        ->settings()
        ->setAutoReloadOnModeChange(false);

    SitePolicy forget;
    forget.forgetOnClose = true;

    profile
        .blockerService()
        ->settings()
        ->setSitePolicy(
            "forget.example",
            forget);

    const int forgetIndex =
        window.addNewTab();

    wait(200);

    auto *forgetView =
        window.currentView();

    const QString fixture =
        QStringLiteral(
            "<html><body>"
            "Storage fixture"
            "</body></html>");

    forgetView->setHtml(
        fixture,
        QUrl("https://forget.example/"));

    wait(300);

    assert(
        js(
            forgetView->page(),
            "localStorage.setItem('phase22d','keep');true")
            .toBool());

    js(
        forgetView->page(),
        "history.pushState(null,'','/route')");

    assert(
        js(
            forgetView->page(),
            "localStorage.getItem('phase22d')")
            .toString() == "keep");

    forgetView->setHtml(
        fixture,
        QUrl("https://forget.example/"));

    wait(300);

    assert(
        js(
            forgetView->page(),
            "localStorage.getItem('phase22d')")
            .toString() == "keep");

    window.closeTab(forgetIndex);
    wait(700);

    const int reopen =
        window.addNewTab();

    wait(150);

    window
        .currentView()
        ->setHtml(
            fixture,
            QUrl("https://forget.example/"));

    wait(300);

    assert(
        js(
            window.currentView()->page(),
            "localStorage.getItem('phase22d')===null")
            .toBool());

    window.closeTab(reopen);
    wait(250);

    // A first navigation from New Tab must install the destination's cosmetic plan.
    const int youtubeIndex =
        window.addNewTab();

    wait(150);

    auto *youtube =
        window.currentView();

    youtube->setHtml(
        QStringLiteral(
            "<html><body>"
            "<ytd-rich-item-renderer "
            "id='normal'>"
            "Normal"
            "</ytd-rich-item-renderer>"
            "<ytd-rich-item-renderer "
            "id='ad'>"
            "<ytd-ad-slot-renderer>"
            "</ytd-ad-slot-renderer>"
            "</ytd-rich-item-renderer>"
            "</body></html>"),
        QUrl("https://youtube.com/"));

    assert(
        waitForJs(
            youtube->page(),
            "document.readyState==='complete'"
            "&&!!document.getElementById('ad')"
            "&&!!document.getElementById('normal')",
            10000));

    // Cosmetic filtering is installed asynchronously by the navigation/blocker
    // pipeline. Slower Qt WebEngine builds used by Debian/Ubuntu CI may finish
    // loading the synthetic document before the cosmetic plan reaches the
    // renderer, so wait for the observable filtering result rather than relying
    // on fixed post-load timing.
    const bool youtubeCosmeticApplied =
        waitForJs(
            youtube->page(),
            "(() => {"
            "const ad=document.getElementById('ad');"
            "const normal=document.getElementById('normal');"
            "if(!ad||!normal) return false;"
            "return getComputedStyle(ad).display==='none'"
            "&&getComputedStyle(normal).display!=='none';"
            "})()",
            30000);

    if (!youtubeCosmeticApplied) {
        std::cerr
            << "youtube cosmetic filter timeout: "
            << js(
                   youtube->page(),
                   "(() => {"
                   "const ad=document.getElementById('ad');"
                   "const normal=document.getElementById('normal');"
                   "return JSON.stringify({"
                   "ready:document.readyState,"
                   "url:location.href,"
                   "adExists:!!ad,"
                   "normalExists:!!normal,"
                   "adDisplay:ad?getComputedStyle(ad).display:null,"
                   "normalDisplay:normal?"
                   "getComputedStyle(normal).display:null"
                   "});"
                   "})()")
                   .toString()
                   .toStdString()
            << std::endl;
    }

    assert(youtubeCosmeticApplied);

    window.closeTab(youtubeIndex);
    wait(100);

    // The new-tab suggestion selection path must wait for each asynchronous
    // WebEngine/native-bridge step instead of assuming fixed timing.
    const int selectionIndex =
        window.addNewTab();

    wait(400);

    auto *selectionView =
        window.currentView();

    profile.setSearchSuggestionsEnabled(true);

    network.body =
        R"(["choose",["choose one","choose two"]])";

    selectionView->setFocus(Qt::MouseFocusReason);
    wait(100);

    assert(
        waitForJs(
            selectionView->page(),
            "typeof window.ardaliSuggestionBridge==='function'"
            "&&!!document.querySelector('#query')",
            10000));

    js(
        selectionView->page(),
        "document.querySelector('#query').focus();");

    assert(
        waitForJs(
            selectionView->page(),
            "document.activeElement===document.querySelector('#query')",
            5000));

    const int requestsBeforeSelection =
        network.requests;

    bool selectionSuggestionsReady = false;

    for (int attempt = 0;
         attempt < 3 && !selectionSuggestionsReady;
         ++attempt) {

        selectionView->setFocus(Qt::MouseFocusReason);

        js(
            selectionView->page(),
            "(() => {"
            "const query=document.querySelector('#query');"
            "if(!query) return false;"
            "query.focus();"
            "query.value='choose';"
            "query.dispatchEvent("
            "new Event('input',{bubbles:true}));"
            "return true;"
            "})()");

        assert(
            waitForJs(
                selectionView->page(),
                "document.querySelector('#query')"
                "&&document.querySelector('#query').value==='choose'",
                5000));

        selectionSuggestionsReady =
            waitForJs(
                selectionView->page(),
                "(() => {"
                "const rows=Array.from("
                "document.querySelectorAll('.suggestion-row'));"
                "const text=rows.map("
                "x=>x.textContent.trim());"
                "return rows.length>1"
                "&&text.includes('choose one')"
                "&&text.includes('choose two');"
                "})()",
                5000);

        if (!selectionSuggestionsReady)
            wait(100);
    }

    assert(
        network.requests > requestsBeforeSelection);

    if (!selectionSuggestionsReady) {
        std::cerr
            << "selection suggestion timeout: requests="
            << network.requests
            << " lastUrl="
            << network.last.url().toString().toStdString()
            << " js="
            << js(
                   selectionView->page(),
                   "JSON.stringify({"
                   "focus:document.hasFocus(),"
                   "active:document.activeElement?.id,"
                   "value:document.querySelector('#query')?.value,"
                   "rows:Array.from("
                   "document.querySelectorAll('.suggestion-row'))"
                   ".map(x=>x.textContent)"
                   "})")
                   .toString()
                   .toStdString()
            << std::endl;
    }

    assert(selectionSuggestionsReady);

    js(
        selectionView->page(),
        "document.querySelector('#query').dispatchEvent("
        "new KeyboardEvent("
        "'keydown',"
        "{key:'ArrowDown',bubbles:true}"
        "));");

    assert(
        waitForJs(
            selectionView->page(),
            "document.querySelector('#query')"
            ".getAttribute('aria-activedescendant')==='suggestion-0'",
            5000));

    js(
        selectionView->page(),
        "document.querySelector('#query').dispatchEvent("
        "new KeyboardEvent("
        "'keydown',"
        "{key:'Enter',bubbles:true,cancelable:true}"
        "));");

    QElapsedTimer navigationTimer;
    navigationTimer.start();

    while (
        selectionView->page()->requestedUrl().host() !=
            QStringLiteral("www.google.com") &&
        selectionView->page()->requestedUrl().host() !=
            QStringLiteral("google.com") &&
        navigationTimer.elapsed() < 10000) {
        wait(50);
    }

    assert(
        selectionView->page()->requestedUrl().host() ==
            QStringLiteral("www.google.com") ||
        selectionView->page()->requestedUrl().host() ==
            QStringLiteral("google.com"));

    selectionView->stop();

    window.closeTab(selectionIndex);
    wait(100);

    // Profile objects, stores, counters and suggestion policy stay separate.
    BrowserProfileService privateProfile(
        root.path() + "/private",
        nullptr,
        nullptr,
        true);

    assert(
        privateProfile
            .profile()
            ->isOffTheRecord());

    assert(
        privateProfile
            .recentHistory()
            .isEmpty());

    assert(
        privateProfile
            .bookmarks()
            .isEmpty());

    assert(
        !privateProfile
             .searchSuggestions()
             ->isEnabled());

    privateProfile.recordHistory(
        QUrl("https://private.example/"),
        "Private",
        true);

    for (const auto &entry :
         profile.recentHistory()) {
        assert(
            entry
                .url
                .host() !=
                QStringLiteral("private.example"));
    }

    SitePolicy privatePolicy;
    privatePolicy.whitelisted = true;

    privateProfile
        .blockerService()
        ->settings()
        ->setSitePolicy(
            "private.example",
            privatePolicy);

    assert(
        !profile
             .blockerService()
             ->settings()
             ->sitePolicy("private.example")
             .whitelisted);

    BrowserServices privateServices;
    privateServices.profile =
        privateProfile.profile();
    privateServices.profileService =
        &privateProfile;

    BrowserWindow privateWindow(
        privateServices,
        true);

    assert(
        !window.transferTabTo(
            window.findTabIdByIndex(0),
            &privateWindow,
            0));

    std::cout
        << "New Tab bridge/consent, local and remote results, "
           "whitespace, keyboard, injection defense, omnibox "
           "and profile isolation passed\n";

    return 0;
}