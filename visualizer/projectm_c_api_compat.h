#pragma once

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* projectm_handle;

typedef enum projectm_channels {
    PROJECTM_MONO = 1,
    PROJECTM_STEREO = 2
} projectm_channels;

projectm_handle projectm_create(void);
void projectm_destroy(projectm_handle instance);
uint32_t projectm_pcm_get_max_samples(void);
void projectm_pcm_add_float(projectm_handle instance, const float* samples, uint32_t count, projectm_channels channels);
void projectm_set_mesh_size(projectm_handle instance, uint32_t width, uint32_t height);
void projectm_set_fps(projectm_handle instance, uint32_t fps);
void projectm_load_preset_file(projectm_handle instance, const char* presetPath, int smoothTransition);
void projectm_set_window_size(projectm_handle instance, uint32_t width, uint32_t height);
void projectm_opengl_render_frame(projectm_handle instance);

#ifdef __cplusplus
}
#endif
