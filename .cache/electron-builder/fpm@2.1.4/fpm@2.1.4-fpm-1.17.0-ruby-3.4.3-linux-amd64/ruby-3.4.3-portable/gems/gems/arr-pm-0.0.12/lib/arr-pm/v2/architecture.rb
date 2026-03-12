require "arr-pm/namespace"

module ArrPM::V2::Architecture

  NOARCH = 0
  I386 = 1
  ALPHA = 2
  SPARC = 3
  MIPS = 4
  PPC = 5
  M68K = 6
  IP = 7
  RS6000 = 8
  IA64 = 9
  SPARC64 = 10
  MIPSEL = 11
  ARM = 12
  MK68KMINT = 13
  S390 = 14
  S390X = 15
  PPC64 = 16
  SH = 17
  XTENSA = 18
  X86_64 = 19

  module_function

  # Is a given rpm architecture value valid?
  def valid?(value)
    return value >= 0 && value <= 19
  end
end
