#include "gl_loader.h"

#include <iostream>

#ifdef IMGUI_IMPL_OPENGL_LOADER_CUSTOM
PFNGLACTIVETEXTUREPROC ArDali_glActiveTexture = nullptr;
PFNGLATTACHSHADERPROC ArDali_glAttachShader = nullptr;
PFNGLBINDBUFFERPROC ArDali_glBindBuffer = nullptr;
PFNGLBINDSAMPLERPROC ArDali_glBindSampler = nullptr;
PFNGLBINDVERTEXARRAYPROC ArDali_glBindVertexArray = nullptr;
PFNGLBLENDEQUATIONPROC ArDali_glBlendEquation = nullptr;
PFNGLBLENDEQUATIONSEPARATEPROC ArDali_glBlendEquationSeparate = nullptr;
PFNGLBLENDFUNCSEPARATEPROC ArDali_glBlendFuncSeparate = nullptr;
PFNGLBUFFERDATAPROC ArDali_glBufferData = nullptr;
PFNGLBUFFERSUBDATAPROC ArDali_glBufferSubData = nullptr;
PFNGLCLIPCONTROLPROC ArDali_glClipControl = nullptr;
PFNGLCOMPILESHADERPROC ArDali_glCompileShader = nullptr;
PFNGLCREATEPROGRAMPROC ArDali_glCreateProgram = nullptr;
PFNGLCREATESHADERPROC ArDali_glCreateShader = nullptr;
PFNGLDELETEBUFFERSPROC ArDali_glDeleteBuffers = nullptr;
PFNGLDELETEPROGRAMPROC ArDali_glDeleteProgram = nullptr;
PFNGLDELETESHADERPROC ArDali_glDeleteShader = nullptr;
PFNGLDELETEVERTEXARRAYSPROC ArDali_glDeleteVertexArrays = nullptr;
PFNGLDETACHSHADERPROC ArDali_glDetachShader = nullptr;
PFNGLDISABLEVERTEXATTRIBARRAYPROC ArDali_glDisableVertexAttribArray = nullptr;
PFNGLDRAWELEMENTSBASEVERTEXPROC ArDali_glDrawElementsBaseVertex = nullptr;
PFNGLENABLEVERTEXATTRIBARRAYPROC ArDali_glEnableVertexAttribArray = nullptr;
PFNGLGENBUFFERSPROC ArDali_glGenBuffers = nullptr;
PFNGLGENVERTEXARRAYSPROC ArDali_glGenVertexArrays = nullptr;
PFNGLGETATTRIBLOCATIONPROC ArDali_glGetAttribLocation = nullptr;
PFNGLGETPROGRAMINFOLOGPROC ArDali_glGetProgramInfoLog = nullptr;
PFNGLGETPROGRAMIVPROC ArDali_glGetProgramiv = nullptr;
PFNGLGETSHADERINFOLOGPROC ArDali_glGetShaderInfoLog = nullptr;
PFNGLGETSHADERIVPROC ArDali_glGetShaderiv = nullptr;
PFNGLGETSTRINGIPROC ArDali_glGetStringi = nullptr;
PFNGLGETUNIFORMLOCATIONPROC ArDali_glGetUniformLocation = nullptr;
PFNGLGETVERTEXATTRIBIVPROC ArDali_glGetVertexAttribiv = nullptr;
PFNGLGETVERTEXATTRIBPOINTERVPROC ArDali_glGetVertexAttribPointerv = nullptr;
PFNGLISPROGRAMPROC ArDali_glIsProgram = nullptr;
PFNGLLINKPROGRAMPROC ArDali_glLinkProgram = nullptr;
PFNGLSHADERSOURCEPROC ArDali_glShaderSource = nullptr;
PFNGLUNIFORM1IPROC ArDali_glUniform1i = nullptr;
PFNGLUNIFORMMATRIX4FVPROC ArDali_glUniformMatrix4fv = nullptr;
PFNGLUSEPROGRAMPROC ArDali_glUseProgram = nullptr;
PFNGLVERTEXATTRIBPOINTERPROC ArDali_glVertexAttribPointer = nullptr;
#else
// Ensure the symbols exist even if IMGUI_IMPL_OPENGL_LOADER_CUSTOM is not defined in this TU.
// We compile this file as part of the executable; imgui target defines the macro.
PFNGLACTIVETEXTUREPROC ArDali_glActiveTexture = nullptr;
PFNGLATTACHSHADERPROC ArDali_glAttachShader = nullptr;
PFNGLBINDBUFFERPROC ArDali_glBindBuffer = nullptr;
PFNGLBINDSAMPLERPROC ArDali_glBindSampler = nullptr;
PFNGLBINDVERTEXARRAYPROC ArDali_glBindVertexArray = nullptr;
PFNGLBLENDEQUATIONPROC ArDali_glBlendEquation = nullptr;
PFNGLBLENDEQUATIONSEPARATEPROC ArDali_glBlendEquationSeparate = nullptr;
PFNGLBLENDFUNCSEPARATEPROC ArDali_glBlendFuncSeparate = nullptr;
PFNGLBUFFERDATAPROC ArDali_glBufferData = nullptr;
PFNGLBUFFERSUBDATAPROC ArDali_glBufferSubData = nullptr;
PFNGLCLIPCONTROLPROC ArDali_glClipControl = nullptr;
PFNGLCOMPILESHADERPROC ArDali_glCompileShader = nullptr;
PFNGLCREATEPROGRAMPROC ArDali_glCreateProgram = nullptr;
PFNGLCREATESHADERPROC ArDali_glCreateShader = nullptr;
PFNGLDELETEBUFFERSPROC ArDali_glDeleteBuffers = nullptr;
PFNGLDELETEPROGRAMPROC ArDali_glDeleteProgram = nullptr;
PFNGLDELETESHADERPROC ArDali_glDeleteShader = nullptr;
PFNGLDELETEVERTEXARRAYSPROC ArDali_glDeleteVertexArrays = nullptr;
PFNGLDETACHSHADERPROC ArDali_glDetachShader = nullptr;
PFNGLDISABLEVERTEXATTRIBARRAYPROC ArDali_glDisableVertexAttribArray = nullptr;
PFNGLDRAWELEMENTSBASEVERTEXPROC ArDali_glDrawElementsBaseVertex = nullptr;
PFNGLENABLEVERTEXATTRIBARRAYPROC ArDali_glEnableVertexAttribArray = nullptr;
PFNGLGENBUFFERSPROC ArDali_glGenBuffers = nullptr;
PFNGLGENVERTEXARRAYSPROC ArDali_glGenVertexArrays = nullptr;
PFNGLGETATTRIBLOCATIONPROC ArDali_glGetAttribLocation = nullptr;
PFNGLGETPROGRAMINFOLOGPROC ArDali_glGetProgramInfoLog = nullptr;
PFNGLGETPROGRAMIVPROC ArDali_glGetProgramiv = nullptr;
PFNGLGETSHADERINFOLOGPROC ArDali_glGetShaderInfoLog = nullptr;
PFNGLGETSHADERIVPROC ArDali_glGetShaderiv = nullptr;
PFNGLGETSTRINGIPROC ArDali_glGetStringi = nullptr;
PFNGLGETUNIFORMLOCATIONPROC ArDali_glGetUniformLocation = nullptr;
PFNGLGETVERTEXATTRIBIVPROC ArDali_glGetVertexAttribiv = nullptr;
PFNGLGETVERTEXATTRIBPOINTERVPROC ArDali_glGetVertexAttribPointerv = nullptr;
PFNGLISPROGRAMPROC ArDali_glIsProgram = nullptr;
PFNGLLINKPROGRAMPROC ArDali_glLinkProgram = nullptr;
PFNGLSHADERSOURCEPROC ArDali_glShaderSource = nullptr;
PFNGLUNIFORM1IPROC ArDali_glUniform1i = nullptr;
PFNGLUNIFORMMATRIX4FVPROC ArDali_glUniformMatrix4fv = nullptr;
PFNGLUSEPROGRAMPROC ArDali_glUseProgram = nullptr;
PFNGLVERTEXATTRIBPOINTERPROC ArDali_glVertexAttribPointer = nullptr;
#endif

static bool loadOne(const char* name, void** out) {
    *out = SDL_GL_GetProcAddress(name);
    return *out != nullptr;
}

bool ArDaliGL_LoadFunctions() {
    // Core functions expected by imgui_impl_opengl3.
    // Some optional functions may fail to load depending on the driver/context.
    bool ok = true;

    ok &= loadOne("glActiveTexture", (void**)&ArDali_glActiveTexture);
    ok &= loadOne("glAttachShader", (void**)&ArDali_glAttachShader);
    ok &= loadOne("glBindBuffer", (void**)&ArDali_glBindBuffer);
    (void)loadOne("glBindSampler", (void**)&ArDali_glBindSampler); // optional
    ok &= loadOne("glBindVertexArray", (void**)&ArDali_glBindVertexArray);
    ok &= loadOne("glBlendEquation", (void**)&ArDali_glBlendEquation);
    ok &= loadOne("glBlendEquationSeparate", (void**)&ArDali_glBlendEquationSeparate);
    ok &= loadOne("glBlendFuncSeparate", (void**)&ArDali_glBlendFuncSeparate);
    ok &= loadOne("glBufferData", (void**)&ArDali_glBufferData);
    ok &= loadOne("glBufferSubData", (void**)&ArDali_glBufferSubData);
    (void)loadOne("glClipControl", (void**)&ArDali_glClipControl); // optional
    ok &= loadOne("glCompileShader", (void**)&ArDali_glCompileShader);
    ok &= loadOne("glCreateProgram", (void**)&ArDali_glCreateProgram);
    ok &= loadOne("glCreateShader", (void**)&ArDali_glCreateShader);
    ok &= loadOne("glDeleteBuffers", (void**)&ArDali_glDeleteBuffers);
    ok &= loadOne("glDeleteProgram", (void**)&ArDali_glDeleteProgram);
    ok &= loadOne("glDeleteShader", (void**)&ArDali_glDeleteShader);
    ok &= loadOne("glDeleteVertexArrays", (void**)&ArDali_glDeleteVertexArrays);
    ok &= loadOne("glDetachShader", (void**)&ArDali_glDetachShader);
    ok &= loadOne("glDisableVertexAttribArray", (void**)&ArDali_glDisableVertexAttribArray);
    (void)loadOne("glDrawElementsBaseVertex", (void**)&ArDali_glDrawElementsBaseVertex); // optional
    ok &= loadOne("glEnableVertexAttribArray", (void**)&ArDali_glEnableVertexAttribArray);
    ok &= loadOne("glGenBuffers", (void**)&ArDali_glGenBuffers);
    ok &= loadOne("glGenVertexArrays", (void**)&ArDali_glGenVertexArrays);
    ok &= loadOne("glGetAttribLocation", (void**)&ArDali_glGetAttribLocation);
    ok &= loadOne("glGetProgramInfoLog", (void**)&ArDali_glGetProgramInfoLog);
    ok &= loadOne("glGetProgramiv", (void**)&ArDali_glGetProgramiv);
    ok &= loadOne("glGetShaderInfoLog", (void**)&ArDali_glGetShaderInfoLog);
    ok &= loadOne("glGetShaderiv", (void**)&ArDali_glGetShaderiv);
    (void)loadOne("glGetStringi", (void**)&ArDali_glGetStringi); // optional
    ok &= loadOne("glGetUniformLocation", (void**)&ArDali_glGetUniformLocation);
    (void)loadOne("glGetVertexAttribiv", (void**)&ArDali_glGetVertexAttribiv); // optional
    (void)loadOne("glGetVertexAttribPointerv", (void**)&ArDali_glGetVertexAttribPointerv); // optional
    (void)loadOne("glIsProgram", (void**)&ArDali_glIsProgram); // optional
    ok &= loadOne("glLinkProgram", (void**)&ArDali_glLinkProgram);
    ok &= loadOne("glShaderSource", (void**)&ArDali_glShaderSource);
    ok &= loadOne("glUniform1i", (void**)&ArDali_glUniform1i);
    ok &= loadOne("glUniformMatrix4fv", (void**)&ArDali_glUniformMatrix4fv);
    ok &= loadOne("glUseProgram", (void**)&ArDali_glUseProgram);
    ok &= loadOne("glVertexAttribPointer", (void**)&ArDali_glVertexAttribPointer);
    // NOTE: glViewport/glScissor/glBlend* etc are core symbols and not loaded here.

    if (!ok) {
        std::cerr << "ArDaliGL_LoadFunctions: missing required OpenGL symbols." << std::endl;
    }

    return ok;
}
