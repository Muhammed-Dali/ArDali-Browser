#pragma once

// Custom OpenGL loader for Dear ImGui OpenGL3 backend.
//
// - We intentionally avoid GLEW/GLX (crashes on Wayland EGL: "No GLX display").
// - Functions are loaded via SDL_GL_GetProcAddress after the GL context is created.
// - ImGui backend enables this via IMGUI_IMPL_OPENGL_LOADER_CUSTOM.
//
// This header is included by third_party/imgui/backends/imgui_impl_opengl3_loader.h.

#include <SDL2/SDL.h>
#include <SDL2/SDL_opengl.h>

// Ensure we have the PFNGL*PROC typedefs.
#ifdef __has_include
#if __has_include(<GL/glext.h>)
#include <GL/glext.h>
#endif
#endif

bool ArDaliGL_LoadFunctions();

// Only remap symbols for the ImGui OpenGL3 backend compilation unit.
#ifdef IMGUI_IMPL_OPENGL_LOADER_CUSTOM

// Function pointers for GL entry points that aren't reliably available as link-time symbols.
//
// NOTE: We intentionally do NOT remap legacy/core-1.1 functions such as glBindTexture, glEnable,
// glDisable, glViewport, glScissor, glTexImage2D, glTexParameteri, glDrawElements, etc.
// Those are provided by the system OpenGL headers+lib and don't have PFNGL*PROC typedefs in
// the extension headers.

// Modern OpenGL symbols used by imgui_impl_opengl3.cpp
extern PFNGLACTIVETEXTUREPROC ArDali_glActiveTexture;
extern PFNGLATTACHSHADERPROC ArDali_glAttachShader;
extern PFNGLBINDBUFFERPROC ArDali_glBindBuffer;
extern PFNGLBINDSAMPLERPROC ArDali_glBindSampler;
extern PFNGLBINDVERTEXARRAYPROC ArDali_glBindVertexArray;
extern PFNGLBLENDEQUATIONPROC ArDali_glBlendEquation;
extern PFNGLBLENDEQUATIONSEPARATEPROC ArDali_glBlendEquationSeparate;
extern PFNGLBLENDFUNCSEPARATEPROC ArDali_glBlendFuncSeparate;
extern PFNGLBUFFERDATAPROC ArDali_glBufferData;
extern PFNGLBUFFERSUBDATAPROC ArDali_glBufferSubData;
extern PFNGLCLIPCONTROLPROC ArDali_glClipControl;
extern PFNGLCOMPILESHADERPROC ArDali_glCompileShader;
extern PFNGLCREATEPROGRAMPROC ArDali_glCreateProgram;
extern PFNGLCREATESHADERPROC ArDali_glCreateShader;
extern PFNGLDELETEBUFFERSPROC ArDali_glDeleteBuffers;
extern PFNGLDELETEPROGRAMPROC ArDali_glDeleteProgram;
extern PFNGLDELETESHADERPROC ArDali_glDeleteShader;
extern PFNGLDELETEVERTEXARRAYSPROC ArDali_glDeleteVertexArrays;
extern PFNGLDETACHSHADERPROC ArDali_glDetachShader;
extern PFNGLDISABLEVERTEXATTRIBARRAYPROC ArDali_glDisableVertexAttribArray;
extern PFNGLDRAWELEMENTSBASEVERTEXPROC ArDali_glDrawElementsBaseVertex;
extern PFNGLENABLEVERTEXATTRIBARRAYPROC ArDali_glEnableVertexAttribArray;
extern PFNGLGENBUFFERSPROC ArDali_glGenBuffers;
extern PFNGLGENVERTEXARRAYSPROC ArDali_glGenVertexArrays;
extern PFNGLGETATTRIBLOCATIONPROC ArDali_glGetAttribLocation;
extern PFNGLGETPROGRAMINFOLOGPROC ArDali_glGetProgramInfoLog;
extern PFNGLGETPROGRAMIVPROC ArDali_glGetProgramiv;
extern PFNGLGETSHADERINFOLOGPROC ArDali_glGetShaderInfoLog;
extern PFNGLGETSHADERIVPROC ArDali_glGetShaderiv;
extern PFNGLGETSTRINGIPROC ArDali_glGetStringi;
extern PFNGLGETUNIFORMLOCATIONPROC ArDali_glGetUniformLocation;
extern PFNGLGETVERTEXATTRIBIVPROC ArDali_glGetVertexAttribiv;
extern PFNGLGETVERTEXATTRIBPOINTERVPROC ArDali_glGetVertexAttribPointerv;
extern PFNGLISPROGRAMPROC ArDali_glIsProgram;
extern PFNGLLINKPROGRAMPROC ArDali_glLinkProgram;
extern PFNGLSHADERSOURCEPROC ArDali_glShaderSource;
extern PFNGLUNIFORM1IPROC ArDali_glUniform1i;
extern PFNGLUNIFORMMATRIX4FVPROC ArDali_glUniformMatrix4fv;
extern PFNGLUSEPROGRAMPROC ArDali_glUseProgram;
extern PFNGLVERTEXATTRIBPOINTERPROC ArDali_glVertexAttribPointer;

// Map standard OpenGL names to our function pointers for the backend.
#define glActiveTexture ArDali_glActiveTexture
#define glAttachShader ArDali_glAttachShader
#define glBindBuffer ArDali_glBindBuffer
#define glBindSampler ArDali_glBindSampler
#define glBindVertexArray ArDali_glBindVertexArray
#define glBlendEquation ArDali_glBlendEquation
#define glBlendEquationSeparate ArDali_glBlendEquationSeparate
#define glBlendFuncSeparate ArDali_glBlendFuncSeparate
#define glBufferData ArDali_glBufferData
#define glBufferSubData ArDali_glBufferSubData
#define glClipControl ArDali_glClipControl
#define glCompileShader ArDali_glCompileShader
#define glCreateProgram ArDali_glCreateProgram
#define glCreateShader ArDali_glCreateShader
#define glDeleteBuffers ArDali_glDeleteBuffers
#define glDeleteProgram ArDali_glDeleteProgram
#define glDeleteShader ArDali_glDeleteShader
#define glDeleteVertexArrays ArDali_glDeleteVertexArrays
#define glDetachShader ArDali_glDetachShader
#define glDisableVertexAttribArray ArDali_glDisableVertexAttribArray
#define glDrawElementsBaseVertex ArDali_glDrawElementsBaseVertex
#define glEnableVertexAttribArray ArDali_glEnableVertexAttribArray
#define glGenBuffers ArDali_glGenBuffers
#define glGenVertexArrays ArDali_glGenVertexArrays
#define glGetAttribLocation ArDali_glGetAttribLocation
#define glGetProgramInfoLog ArDali_glGetProgramInfoLog
#define glGetProgramiv ArDali_glGetProgramiv
#define glGetShaderInfoLog ArDali_glGetShaderInfoLog
#define glGetShaderiv ArDali_glGetShaderiv
#define glGetStringi ArDali_glGetStringi
#define glGetUniformLocation ArDali_glGetUniformLocation
#define glGetVertexAttribiv ArDali_glGetVertexAttribiv
#define glGetVertexAttribPointerv ArDali_glGetVertexAttribPointerv
#define glIsProgram ArDali_glIsProgram
#define glLinkProgram ArDali_glLinkProgram
#define glShaderSource ArDali_glShaderSource
#define glUniform1i ArDali_glUniform1i
#define glUniformMatrix4fv ArDali_glUniformMatrix4fv
#define glUseProgram ArDali_glUseProgram
#define glVertexAttribPointer ArDali_glVertexAttribPointer

#endif // IMGUI_IMPL_OPENGL_LOADER_CUSTOM
