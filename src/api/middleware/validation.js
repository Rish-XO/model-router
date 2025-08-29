const joi = require('joi');

// OpenAI chat completion schema
const chatCompletionSchema = joi.object({
  model: joi.string().required(),
  messages: joi.array().items(
    joi.object({
      role: joi.string().valid('system', 'user', 'assistant').required(),
      content: joi.string().required()
    })
  ).min(1).required(),
  max_tokens: joi.number().integer().min(1).max(4000).optional(),
  temperature: joi.number().min(0).max(2).optional(),
  top_p: joi.number().min(0).max(1).optional()
});

const validateChatCompletion = (req, res, next) => {
  const { error, value } = chatCompletionSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      error: {
        message: `Invalid request: ${error.details[0].message}`,
        type: 'validation_error'
      }
    });
  }
  
  req.body = value; // Use validated data
  next();
};

module.exports = { validateChatCompletion };