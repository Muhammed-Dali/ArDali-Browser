/* Analyzer Container for ArDali
 * Based on ArDali's AnalyzerContainer
 * Provides a container widget with right-click menu for selecting analyzers
 */

#include "analyzercontainer.h"

#include <QGuiApplication>
#include <QHBoxLayout>
#include <QMouseEvent>
#include <QSettings>
#include <QTimer>
#include <QtDebug>

#include "baranalyzer.h"
#include "blockanalyzer.h"
#include "boomanalyzer.h"
#include "sonogram.h"
#include "turbine.h"

const char* AnalyzerContainer::kSettingsGroup = "Analyzer";
const char* AnalyzerContainer::kSettingsFramerate = "framerate";

// Framerates
const int AnalyzerContainer::kLowFramerate = 20;
const int AnalyzerContainer::kMediumFramerate = 25;
const int AnalyzerContainer::kHighFramerate = 30;
const int AnalyzerContainer::kSuperHighFramerate = 60;

AnalyzerContainer::AnalyzerContainer(QWidget* parent)
    : QWidget(parent),
      current_framerate_(kMediumFramerate),
      context_menu_(new QMenu(this)),
      context_menu_framerate_(new QMenu(tr("Framerate"), this)),
      group_(new QActionGroup(this)),
      group_framerate_(new QActionGroup(this)),
      psychedelic_colors_on_(false),
      current_analyzer_(nullptr),
      engine_(nullptr) {
  QHBoxLayout* layout = new QHBoxLayout(this);
  setLayout(layout);
  layout->setContentsMargins(0, 0, 0, 0);

  // Init framerate sub-menu
  AddFramerate(tr("Low (%1 fps)").arg(kLowFramerate), kLowFramerate);
  AddFramerate(tr("Medium (%1 fps)").arg(kMediumFramerate), kMediumFramerate);
  AddFramerate(tr("High (%1 fps)").arg(kHighFramerate), kHighFramerate);
  AddFramerate(tr("Super high (%1 fps)").arg(kSuperHighFramerate),
               kSuperHighFramerate);

  context_menu_->addMenu(context_menu_framerate_);
  context_menu_->addSeparator();

  AddAnalyzerType<BarAnalyzer>();
  AddAnalyzerType<BlockAnalyzer>();
  AddAnalyzerType<BoomAnalyzer>();
  AddAnalyzerType<Sonogram>();
  AddAnalyzerType<TurbineAnalyzer>();

  disable_action_ = context_menu_->addAction(tr("No analyzer"), this,
                                             SLOT(DisableAnalyzer()));
  disable_action_->setCheckable(true);
  group_->addAction(disable_action_);

  context_menu_->addSeparator();
  psychedelic_enable_ = context_menu_->addAction(
      tr("Use Psychedelic Colors"), this, SLOT(TogglePsychedelicColors()));
  psychedelic_enable_->setCheckable(true);

  Load();
}

void AnalyzerContainer::mouseReleaseEvent(QMouseEvent* e) {
  if (e->button() == Qt::LeftButton || e->button() == Qt::RightButton) {
    context_menu_->popup(e->globalPosition().toPoint());
  }
}

void AnalyzerContainer::wheelEvent(QWheelEvent* e) {
  emit WheelEvent(e->angleDelta().y());
}

void AnalyzerContainer::SetEngine(EngineBase* engine) {
  if (current_analyzer_) current_analyzer_->set_engine(engine);
  engine_ = engine;
}

void AnalyzerContainer::DisableAnalyzer() {
  if (current_analyzer_) {
    // Disconnect from engine first to stop timer callbacks
    current_analyzer_->set_engine(nullptr);
    current_analyzer_->hide();
    layout()->removeWidget(current_analyzer_);
    
    // Store pointer and null it before deletion
    Analyzer::Base* oldAnalyzer = current_analyzer_;
    current_analyzer_ = nullptr;
    delete oldAnalyzer;  // Direct delete after engine disconnect
  }

  Save();
}

void AnalyzerContainer::TogglePsychedelicColors() {
  psychedelic_colors_on_ = !psychedelic_colors_on_;
  if (current_analyzer_) {
    current_analyzer_->psychedelicModeChanged(psychedelic_colors_on_);
  }
  SavePsychedelic();
}

void AnalyzerContainer::ChangeAnalyzer(int id) {
  // Safety: ensure container is visible and has valid size
  if (!isVisible() || width() <= 0 || height() <= 0) {
    qWarning() << "AnalyzerContainer not ready, deferring analyzer creation";
    // Defer creation
    QTimer::singleShot(100, this, [this, id]() {
      if (isVisible() && width() > 0 && height() > 0) {
        ChangeAnalyzer(id);
      }
    });
    return;
  }

  // Delete old analyzer safely FIRST
  if (current_analyzer_) {
    // Disconnect from engine and stop timer before deletion
    current_analyzer_->set_engine(nullptr);
    current_analyzer_->hide();
    layout()->removeWidget(current_analyzer_);
    
    // Store pointer and null it before deletion to prevent any race conditions
    Analyzer::Base* oldAnalyzer = current_analyzer_;
    current_analyzer_ = nullptr;
    delete oldAnalyzer;  // Direct delete after engine disconnect
  }

  Analyzer::Base* newAnalyzer = nullptr;
  
  // Factory pattern - direct instantiation instead of newInstance()
  switch (id) {
    case 0: newAnalyzer = new BarAnalyzer(this); break;
    case 1: newAnalyzer = new BlockAnalyzer(this); break;
    case 2: newAnalyzer = new BoomAnalyzer(this); break;
    case 3: newAnalyzer = new Sonogram(this); break;
    case 4: newAnalyzer = new TurbineAnalyzer(this); break;
    default:
      qWarning() << "Unknown analyzer type id:" << id;
      return;
  }

  if (!newAnalyzer) {
    qWarning() << "Couldn't create analyzer for id:" << id;
    return;
  }
  
  current_analyzer_ = newAnalyzer;
  current_analyzer_->set_engine(engine_);
  current_framerate_ =
      current_framerate_ == 0 ? kMediumFramerate : current_framerate_;
  current_analyzer_->changeTimeout(1000 / current_framerate_);
  current_analyzer_->psychedelicModeChanged(psychedelic_colors_on_);

  layout()->addWidget(current_analyzer_);

  Save();
}

void AnalyzerContainer::ChangeFramerate(int new_framerate) {
  if (current_analyzer_) {
    new_framerate = new_framerate == 0 ? kMediumFramerate : new_framerate;
    current_analyzer_->changeTimeout(1000 / new_framerate);
    current_analyzer_->framerateChanged();
  }
  SaveFramerate(new_framerate);
}

void AnalyzerContainer::Load() {
  QSettings s;
  s.beginGroup(kSettingsGroup);

  // Colours
  psychedelic_colors_on_ = s.value("psychedelic", false).toBool();
  psychedelic_enable_->setChecked(psychedelic_colors_on_);

  // Detect display server (X11 or Wayland)
  QString platform = QGuiApplication::platformName().toLower();
  bool isWayland = platform.contains("wayland");
  bool isX11 = platform.contains("xcb") || platform.contains("x11");
  
  qDebug() << "Display server detected:" << platform 
           << "(Wayland:" << isWayland << ", X11:" << isX11 << ")";

  // Start with no analyzer - let user select via right-click menu
  // This ensures safe initialization on both X11 and Wayland
  disable_action_->setChecked(true);

  // Framerate
  current_framerate_ = s.value(kSettingsFramerate, kMediumFramerate).toInt();
  for (int i = 0; i < framerate_list_.count(); ++i) {
    if (current_framerate_ == framerate_list_[i]) {
      group_framerate_->actions()[i]->setChecked(true);
      break;
    }
  }
}

void AnalyzerContainer::SaveFramerate(int framerate) {
  current_framerate_ = framerate;
  QSettings s;
  s.beginGroup(kSettingsGroup);
  s.setValue(kSettingsFramerate, current_framerate_);
}

void AnalyzerContainer::Save() {
  QSettings s;
  s.beginGroup(kSettingsGroup);

  s.setValue("type", current_analyzer_
                         ? current_analyzer_->metaObject()->className()
                         : QVariant());
}

void AnalyzerContainer::SavePsychedelic() {
  QSettings s;
  s.beginGroup(kSettingsGroup);

  s.setValue("psychedelic", psychedelic_colors_on_);
}

void AnalyzerContainer::AddFramerate(const QString& name, int framerate) {
  QAction* action = context_menu_framerate_->addAction(name);
  group_framerate_->addAction(action);
  framerate_list_ << framerate;
  action->setCheckable(true);
  connect(action, &QAction::triggered,
          [this, framerate]() { ChangeFramerate(framerate); });
}
