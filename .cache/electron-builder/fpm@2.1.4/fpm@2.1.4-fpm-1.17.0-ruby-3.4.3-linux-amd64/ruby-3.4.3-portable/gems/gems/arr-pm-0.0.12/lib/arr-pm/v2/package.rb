# encoding: utf-8

require "arr-pm/namespace"

class ArrPM::V2::RPM
  attr_accessor :name
  attr_accessor :epoch
  attr_accessor :version
  attr_accessor :release

  def initialize
    defaults
  end

  def defaults
    @type = Type::BINARY
  end
end
