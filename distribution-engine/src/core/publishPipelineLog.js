function publishPipelineLog(stage, data = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      service: "distribution-engine",
      component: "PublishPipeline",
      event: "publish_pipeline",
      stage,
      ...data,
    })
  );
}

module.exports = { publishPipelineLog };