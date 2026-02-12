import mongoose from "mongoose";

const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      maxlength: [100, "Category name cannot exceed 100 characters"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },

    // Self-referencing for hierarchy (Adjacency List pattern)
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },

    // Cached path for efficient queries (e.g., "Electronics > Scales > Platform")
    path: {
      type: String,
      default: "",
    },

    // Depth level (0 = root, 1 = child of root, etc.)
    level: {
      type: Number,
      default: 0,
    },

    // Category-specific attributes that products in this category should have
    attributes: [
      {
        name: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ["text", "number", "select", "boolean"],
          default: "text",
        },
        options: [String], // For select type
        required: {
          type: Boolean,
          default: false,
        },
        unit: String, // For number type (e.g., "kg", "mm")
      },
    ],

    // Display order within parent
    sortOrder: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // For soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },

    // Product count cache (updated via hooks)
    productCount: {
      type: Number,
      default: 0,
    },

    // Audit fields
    createdBy: {
      id: String,
      name: String,
    },

    lastModifiedBy: {
      id: String,
      name: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
// Unique category name per company (at same level/parent)
categorySchema.index({ companyId: 1, name: 1, parent: 1 }, { unique: true });
// Query indexes - prefixed with companyId for tenant isolation
categorySchema.index({ companyId: 1, parent: 1, sortOrder: 1 });
categorySchema.index({ companyId: 1, isActive: 1, isDeleted: 1 });
categorySchema.index({ companyId: 1, slug: 1 });
categorySchema.index({ name: "text", description: "text" }); // Text search

// Pre-save: Generate slug and update path
categorySchema.pre("save", async function (next) {
  // Generate slug from name if not provided or name changed
  if (this.isModified("name") || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    // Ensure unique slug
    const Category = mongoose.model("Category");
    let slugExists = await Category.findOne({
      slug: this.slug,
      _id: { $ne: this._id },
    });

    let counter = 1;
    const baseSlug = this.slug;
    while (slugExists) {
      this.slug = `${baseSlug}-${counter}`;
      slugExists = await Category.findOne({
        slug: this.slug,
        _id: { $ne: this._id },
      });
      counter++;
    }
  }

  // Update path and level based on parent
  if (this.isModified("parent") || this.isNew) {
    if (this.parent) {
      const Category = mongoose.model("Category");
      const parentCategory = await Category.findById(this.parent);
      if (parentCategory) {
        this.path = parentCategory.path
          ? `${parentCategory.path} > ${this.name}`
          : this.name;
        this.level = parentCategory.level + 1;
      }
    } else {
      this.path = this.name;
      this.level = 0;
    }
  }
});

// Static: Get category tree
categorySchema.statics.getTree = async function (includeInactive = false) {
  const filter = { isDeleted: false };
  if (!includeInactive) {
    filter.isActive = true;
  }

  const categories = await this.find(filter)
    .sort({ level: 1, sortOrder: 1, name: 1 })
    .lean();

  // Build tree structure
  const categoryMap = new Map();
  const tree = [];

  // First pass: create map
  categories.forEach((cat) => {
    categoryMap.set(cat._id.toString(), { ...cat, children: [] });
  });

  // Second pass: build tree
  categories.forEach((cat) => {
    const node = categoryMap.get(cat._id.toString());
    if (cat.parent) {
      const parent = categoryMap.get(cat.parent.toString());
      if (parent) {
        parent.children.push(node);
      } else {
        tree.push(node); // Parent not found, treat as root
      }
    } else {
      tree.push(node);
    }
  });

  return tree;
};

// Static: Get flat list with indentation info (for select dropdowns)
categorySchema.statics.getFlatList = async function (includeInactive = false) {
  const filter = { isDeleted: false };
  if (!includeInactive) {
    filter.isActive = true;
  }

  const categories = await this.find(filter)
    .sort({ path: 1, sortOrder: 1 })
    .lean();

  return categories.map((cat) => ({
    _id: cat._id,
    name: cat.name,
    path: cat.path,
    level: cat.level,
    // For display in dropdowns: "── ── Category Name" based on level
    displayName:
      cat.level > 0 ? `${"── ".repeat(cat.level)}${cat.name}` : cat.name,
    parent: cat.parent,
    productCount: cat.productCount,
  }));
};

// Static: Search categories
categorySchema.statics.search = async function (query, limit = 10) {
  if (!query || query.trim().length < 2) {
    return this.getFlatList();
  }

  const regex = new RegExp(query.trim(), "i");

  const categories = await this.find({
    isDeleted: false,
    isActive: true,
    $or: [{ name: regex }, { description: regex }, { path: regex }],
  })
    .sort({ level: 1, name: 1 })
    .limit(limit)
    .lean();

  return categories.map((cat) => ({
    _id: cat._id,
    name: cat.name,
    path: cat.path,
    level: cat.level,
    displayName: cat.path || cat.name,
  }));
};

// Instance: Get all descendants
categorySchema.methods.getDescendants = async function () {
  const Category = mongoose.model("Category");
  const descendants = [];

  const findChildren = async (parentId) => {
    const children = await Category.find({
      parent: parentId,
      isDeleted: false,
    }).lean();

    for (const child of children) {
      descendants.push(child);
      await findChildren(child._id);
    }
  };

  await findChildren(this._id);
  return descendants;
};

// Instance: Get ancestors (breadcrumb)
categorySchema.methods.getAncestors = async function () {
  const Category = mongoose.model("Category");
  const ancestors = [];
  let current = this;

  while (current.parent) {
    const parent = await Category.findById(current.parent).lean();
    if (parent) {
      ancestors.unshift(parent);
      current = parent;
    } else {
      break;
    }
  }

  return ancestors;
};

// Prevent deletion if category has products
categorySchema.methods.safeDelete = async function (userId, userName) {
  if (this.productCount > 0) {
    throw new Error(
      `Cannot delete category with ${this.productCount} products. Reassign products first.`
    );
  }

  // Check for child categories
  const Category = mongoose.model("Category");
  const childCount = await Category.countDocuments({
    parent: this._id,
    isDeleted: false,
  });

  if (childCount > 0) {
    throw new Error(
      `Cannot delete category with ${childCount} subcategories. Delete or reassign subcategories first.`
    );
  }

  this.isDeleted = true;
  this.lastModifiedBy = { id: userId, name: userName };
  await this.save();
};

const Category =
  mongoose.models.Category || mongoose.model("Category", categorySchema);

export default Category;
export { Category };
