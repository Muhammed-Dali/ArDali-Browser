/* Fast Hartley Transform for ArDali
 * Based on ArDali's FHT implementation
 * Original Author: Melchior FRANZ <mfranz@kde.org> 2004
 */

#ifndef ANALYZERS_FHT_H_
#define ANALYZERS_FHT_H_

#include <QVector>

/**
 * Implementation of the Hartley Transform after Bracewell's discrete
 * algorithm. The algorithm is subject to US patent No. 4,646,256 (1987)
 * but was put into public domain by the Board of Trustees of Stanford
 * University in 1994 and is now freely available.
 */
class FHT {
  const int num_;
  const int exp2_;

  QVector<float> buf_vector_;
  QVector<float> tab_vector_;
  QVector<int> log_vector_;

  float* buf_();
  float* tab_();
  int* log_();

  void makeCasTable();
  void _transform(float*, int, int);

 public:
  FHT(int);
  ~FHT();
  
  int sizeExp() const;
  int size() const;
  void scale(float*, float);
  void ewma(float* d, float* s, float w);
  void logSpectrum(float* out, float* p);
  void semiLogSpectrum(float*);
  void spectrum(float*);
  void power(float*);
  void power2(float*);
  void transform8(float*);
  void transform(float*);
};

#endif  // ANALYZERS_FHT_H_
