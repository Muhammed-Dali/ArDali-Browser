require "arr-pm/namespace"

module ArrPM::V2::Type
  BINARY = 0
  SOURCE = 1

  module_function

  # Is a given rpm type value valid?
  #
  # The only valid types are BINARY (0) or SOURCE (1)
  def valid?(value)
    return (value == BINARY || value == SOURCE)
  end
end
