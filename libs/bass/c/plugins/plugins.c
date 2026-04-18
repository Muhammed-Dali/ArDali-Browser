/*
	BASS plugins example
	Copyright (c) 2005-2025 Un4seen Developments Ltd.
*/

#define GDK_VERSION_MIN_REQUIRED GDK_VERSION_3_0
#include <gtk/gtk.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <regex.h>
#include <glob.h>
#include "bass.h"

#define UIFILE "plugins.ui"
GtkBuilder *builder;

GtkWidget *win;
GtkWidget *filesel;

DWORD chan;	// channel handle

// display error messages
void Error(const char *es)
{
	GtkWidget *dialog = gtk_message_dialog_new(GTK_WINDOW(win), GTK_DIALOG_DESTROY_WITH_PARENT,
		GTK_MESSAGE_ERROR, GTK_BUTTONS_OK, "%s\n(error code: %d)", es, BASS_ErrorGetCode());
	gtk_dialog_run(GTK_DIALOG(dialog));
	gtk_widget_destroy(dialog);
}

// translate a CTYPE value to text
const char *GetCTypeString(DWORD ctype, HPLUGIN plugin)
{
	if (plugin) { // using a plugin
		const BASS_PLUGININFO *pinfo = BASS_PluginGetInfo(plugin); // get plugin info
		int a;
		for (a = 0; a < pinfo->formatc; a++) {
			if (pinfo->formats[a].ctype == ctype) // found a "ctype" match
				return pinfo->formats[a].name; // return it's name
		}
	}
	// check built-in stream formats
	if (ctype == BASS_CTYPE_STREAM_VORBIS) return "Ogg Vorbis";
	if (ctype == BASS_CTYPE_STREAM_MP1) return "MPEG layer 1";
	if (ctype == BASS_CTYPE_STREAM_MP2) return "MPEG layer 2";
	if (ctype == BASS_CTYPE_STREAM_MP3) return "MPEG layer 3";
	if (ctype == BASS_CTYPE_STREAM_AIFF) return "Audio IFF";
	if (ctype == BASS_CTYPE_STREAM_WAV_PCM) return "PCM WAVE";
	if (ctype == BASS_CTYPE_STREAM_WAV_FLOAT) return "Floating-point WAVE";
	if (ctype & BASS_CTYPE_STREAM_WAV) return "WAVE";
	return "?";
}

#define GetWidget(id) GTK_WIDGET(gtk_builder_get_object(builder,id))

void WindowDestroy(GtkWidget *obj, gpointer data)
{
	gtk_main_quit();
}

gboolean FileExtensionFilter(const GtkFileFilterInfo *info, gpointer data)
{
	return !regexec((regex_t*)data, info->filename, 0, NULL, 0);
}

void OpenClicked(GtkButton *obj, gpointer data)
{
	int resp = gtk_dialog_run(GTK_DIALOG(filesel));
	gtk_widget_hide(filesel);
	if (resp == GTK_RESPONSE_ACCEPT) {
		char *file = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(filesel));
		BASS_StreamFree(chan); // free old stream before opening new
			if (!(chan = BASS_StreamCreateFile(0, file, 0, 0, BASS_SAMPLE_LOOP | BASS_SAMPLE_FLOAT))) {
				gtk_button_set_label(obj, "Open file...");
			gtk_label_set_text(GTK_LABEL(GetWidget("info")), "");
			gtk_label_set_text(GTK_LABEL(GetWidget("positiontext")), "");
			gtk_range_set_range(GTK_RANGE(GetWidget("position")), 0, 0);
			Error("Can't play the file");
			} else {
				{
					const char *name = strrchr(file, '/');
					gtk_button_set_label(obj, name ? name + 1 : file);
				}
				{ // display the file type
					char text[100];
					BASS_CHANNELINFO info;
					BASS_ChannelGetInfo(chan, &info);
					snprintf(text, sizeof(text), "channel type = %x (%s)", info.ctype, GetCTypeString(info.ctype, info.plugin));
					gtk_label_set_text(GTK_LABEL(GetWidget("info")), text);
				}
			{ // update scroller range
				QWORD len = BASS_ChannelGetLength(chan, BASS_POS_BYTE);
				if (len == -1) len = 0; // unknown length
				gtk_range_set_range(GTK_RANGE(GetWidget("position")), 0, BASS_ChannelBytes2Seconds(chan, len));
			}
			BASS_ChannelPlay(chan, FALSE);
		}
		g_free(file);
	}
}

gboolean PositionChange(GtkRange *range, GtkScrollType scroll, gdouble value, gpointer data)
{
	BASS_ChannelSetPosition(chan, BASS_ChannelSeconds2Bytes(chan, value), BASS_POS_BYTE);
	return FALSE;
}

gboolean TimerProc(gpointer data)
{
	if (chan) {
		double len = BASS_ChannelBytes2Seconds(chan, BASS_ChannelGetLength(chan, BASS_POS_BYTE));
		double pos = BASS_ChannelBytes2Seconds(chan, BASS_ChannelGetPosition(chan, BASS_POS_BYTE));
		char text[64];
		snprintf(text, sizeof(text), "%u:%02u / %u:%02u", (int)pos / 60, (int)pos % 60, (int)len / 60, (int)len % 60);
		gtk_label_set_text(GTK_LABEL(GetWidget("positiontext")), text);
		gtk_range_set_value(GTK_RANGE(GetWidget("position")), pos);
	}
	return TRUE;
}

int main(int argc, char* argv[])
{
	gtk_init(&argc, &argv);

	// check the correct BASS was loaded
	if (HIWORD(BASS_GetVersion()) != BASSVERSION) {
		Error("An incorrect version of BASS was loaded");
		return 0;
	}

	// initialize default output device
	if (!BASS_Init(-1, 44100, 0, NULL, NULL)) {
		Error("Can't initialize device");
		return 0;
	}

	// initialize GUI
	builder = gtk_builder_new();
	if (!gtk_builder_add_from_file(builder, UIFILE, NULL)) {
		char path[PATH_MAX];
		ssize_t n = readlink("/proc/self/exe", path, sizeof(path) - 1);
		if (n < 0) n = 0;
		path[n] = '\0';
		{
			char *slash = strrchr(path, '/');
			if (slash) {
				snprintf(slash + 1, (size_t)(path + sizeof(path) - (slash + 1)), "%s", UIFILE);
			} else {
				snprintf(path, sizeof(path), "%s", UIFILE);
			}
		}
		if (!gtk_builder_add_from_file(builder, path, NULL)) {
			Error("Can't load UI");
			return 0;
		}
	}
	win = GetWidget("window1");
	gtk_builder_connect_signals(builder, NULL);

	{ // setup plugin list and file selector
		GtkTreeView *list = GTK_TREE_VIEW(GetWidget("plugins"));
		gtk_tree_view_append_column(list, gtk_tree_view_column_new_with_attributes("", gtk_cell_renderer_text_new(), "text", 0, NULL));
		GtkListStore *liststore = gtk_list_store_new(1, G_TYPE_STRING);
		gtk_tree_view_set_model(list, GTK_TREE_MODEL(liststore));
		g_object_unref(liststore);
		gtk_tree_selection_set_mode(gtk_tree_view_get_selection(list), GTK_SELECTION_NONE);

		GtkFileFilter *filter;
		regex_t *fregex;
		filesel = gtk_file_chooser_dialog_new("Open File", GTK_WINDOW(win), GTK_FILE_CHOOSER_ACTION_OPEN,
			GTK_STOCK_CANCEL, GTK_RESPONSE_CANCEL, GTK_STOCK_OPEN, GTK_RESPONSE_ACCEPT, NULL);
		filter = gtk_file_filter_new();
		gtk_file_filter_set_name(filter, "BASS built-in (*.wav;*.aif;*.mp3;*.mp2;*.mp1;*.ogg)");
		fregex = malloc(sizeof(*fregex));
		regcomp(fregex, "\\.(mp[1-3]|ogg|wav|aif)$", REG_ICASE | REG_NOSUB | REG_EXTENDED);
		gtk_file_filter_add_custom(filter, GTK_FILE_FILTER_FILENAME, FileExtensionFilter, fregex, NULL);
		gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(filesel), filter);
		{ // look for plugins (alongside BASS library)
				const char *basspath = BASS_GetConfigPtr(BASS_CONFIG_FILENAME);
				if (basspath) {
					glob_t g;
					const char *sep = strrchr(basspath, '/');
					if (!sep) sep = basspath;
					else sep += 1;
					int pathlen = (int)(sep - basspath);
					char *pattern = alloca(pathlen + 13);
					snprintf(pattern, pathlen + 13, "%.*slibbass?*.so", pathlen, basspath);
					if (!glob(pattern, 0, 0, &g)) {
					int a;
					for (a = 0; a < g.gl_pathc; a++) {
						HPLUGIN plug = BASS_PluginLoad(g.gl_pathv[a], 0);
						if (plug) { // plugin loaded
								// add it to the list
								const char *file = strrchr(g.gl_pathv[a], '/');
								file = file ? file + 1 : g.gl_pathv[a];
							GtkTreeIter it;
							gtk_list_store_append(liststore, &it);
							gtk_list_store_set(liststore, &it, 0, file, -1);
							// get plugin info to add to the file selector filter
							const BASS_PLUGININFO *pinfo = BASS_PluginGetInfo(plug);
							int b;
								for (b = 0; b < pinfo->formatc; b++) {
									char buf[4000], *p;
									filter = gtk_file_filter_new();
									snprintf(buf, sizeof(buf), "%s (%s) - %s", pinfo->formats[b].name, pinfo->formats[b].exts, file);
									gtk_file_filter_set_name(filter, buf);
									// build filter regex
									snprintf(buf, sizeof(buf), "\\.(%s)$", pinfo->formats[b].exts);
								while (p = strchr(buf, '*')) { // find an extension
									if (p[-1] == ';') // not the first
										p[-1] = '|'; // add an alternation
									memmove(p, p + 2, strlen(p + 2) + 1); // remove the "*."
								}
								fregex = malloc(sizeof(*fregex));
								regcomp(fregex, buf, REG_ICASE | REG_NOSUB | REG_EXTENDED);
								gtk_file_filter_add_custom(filter, GTK_FILE_FILTER_FILENAME, FileExtensionFilter, fregex, NULL);
								gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(filesel), filter);
							}
						}
					}
					globfree(&g);
				}
			}
			{
				GtkTreeIter it;
				if (!gtk_tree_model_get_iter_first(GTK_TREE_MODEL(liststore), &it)) {
					gtk_list_store_append(liststore, &it);
					gtk_list_store_set(liststore, &it, 0, "no plugins - visit the BASS webpage to get some", -1);
				}
			}
		}
		filter = gtk_file_filter_new();
		gtk_file_filter_set_name(filter, "All files");
		gtk_file_filter_add_pattern(filter, "*");
		gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(filesel), filter);
	}

	g_timeout_add(100, TimerProc, NULL); // timer to update the position display

	gtk_main();

	gtk_widget_destroy(filesel);

	BASS_Free();
	BASS_PluginFree(0); // unload all plugins

	return 0;
}
