require 'json'

Pod::Spec.new do |s|
  s.name           = 'SageLive'
  s.version        = '1.0.0'
  s.summary        = 'The line as a Live Activity: tokens out, start and update in.'
  s.author         = 'Sage'
  s.homepage       = 'https://www.sageonline.io'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
