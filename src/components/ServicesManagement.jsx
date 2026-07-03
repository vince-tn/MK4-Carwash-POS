import { buildDefaultPricing } from "../data/pricing";
import { peso } from "../lib/reportUtils";

export default function ServicesManagement({ pricing, onUpdatePricing }) {
  const { categories, addOns } = pricing;

  function updateCategory(categoryId, patch) {
    onUpdatePricing({
      ...pricing,
      categories: categories.map((category) =>
        category.id === categoryId ? { ...category, ...patch } : category
      ),
    });
  }

  function addCategory() {
    onUpdatePricing({
      ...pricing,
      categories: [
        {
          id: crypto.randomUUID(),
          category: "New Service",
          commissionType: "Washing",
          commissionRate: 30,
          items: [{ id: crypto.randomUUID(), size: "Medium", price: 0 }],
        },
        ...categories,
      ],
    });
  }

  function removeCategory(categoryId) {
    const confirmDelete = confirm(
      "Delete this service category? Existing sales orders keep their saved prices."
    );
    if (!confirmDelete) return;

    onUpdatePricing({
      ...pricing,
      categories: categories.filter((category) => category.id !== categoryId),
    });
  }

  function updateItem(categoryId, itemId, patch) {
    onUpdatePricing({
      ...pricing,
      categories: categories.map((category) =>
        category.id !== categoryId
          ? category
          : {
              ...category,
              items: category.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            }
      ),
    });
  }

  function addItem(categoryId) {
    onUpdatePricing({
      ...pricing,
      categories: categories.map((category) =>
        category.id !== categoryId
          ? category
          : {
              ...category,
              items: [
                ...category.items,
                { id: crypto.randomUUID(), size: "", price: 0 },
              ],
            }
      ),
    });
  }

  function removeItem(categoryId, itemId) {
    const category = categories.find((item) => item.id === categoryId);

    if (category && category.items.length === 1) {
      alert(
        "A service category needs at least one package/size. Delete the whole category instead."
      );
      return;
    }

    onUpdatePricing({
      ...pricing,
      categories: categories.map((category) =>
        category.id !== categoryId
          ? category
          : {
              ...category,
              items: category.items.filter((item) => item.id !== itemId),
            }
      ),
    });
  }

  function updateAddOn(addOnId, patch) {
    onUpdatePricing({
      ...pricing,
      addOns: addOns.map((addOn) =>
        addOn.id === addOnId ? { ...addOn, ...patch } : addOn
      ),
    });
  }

  function addAddOn() {
    onUpdatePricing({
      ...pricing,
      addOns: [...addOns, { id: crypto.randomUUID(), name: "", price: 0 }],
    });
  }

  function removeAddOn(addOnId) {
    const confirmDelete = confirm("Remove this add-on?");
    if (!confirmDelete) return;

    onUpdatePricing({
      ...pricing,
      addOns: addOns.filter((addOn) => addOn.id !== addOnId),
    });
  }

  function resetDefaults() {
    const confirmReset = confirm(
      "Reset all services, packages, prices and add-ons back to the original price list? Your edits will be lost."
    );
    if (!confirmReset) return;

    onUpdatePricing(buildDefaultPricing());
  }

  return (
    <section className="services-page">
      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Admin Setup</span>
          <h2>Services, Packages and Pricing</h2>
        </div>

        <div className="action-row">
          <button className="secondary-btn no-margin" onClick={addCategory}>
            + Add Service Category
          </button>

          <button className="ghost-btn" onClick={resetDefaults}>
            Reset to Defaults
          </button>
        </div>
      </div>

      <div className="info-card">
        <strong>How this works</strong>
        <p>
          Changes here update the Worker Form immediately. Sales orders that
          were already saved keep the price and commission they were created
          with. The commission rate here is the “Default Service Commission”
          used when workers are on the service percentage rule.
        </p>
      </div>

      <div className="worker-list">
        {categories.length === 0 ? (
          <div className="empty-card">
            No service categories yet. Add one or reset to defaults.
          </div>
        ) : (
          categories.map((category) => {
            const prices = category.items.map((item) => Number(item.price) || 0);
            const minPrice = prices.length ? Math.min(...prices) : 0;
            const maxPrice = prices.length ? Math.max(...prices) : 0;

            return (
              <details className="worker-profile" key={category.id}>
                <summary>
                  <div>
                    <strong>{category.category || "Untitled service"}</strong>
                    <span>
                      {category.commissionType || "No type"} •{" "}
                      {Number(category.commissionRate) || 0}% commission •{" "}
                      {category.items.length}{" "}
                      {category.items.length === 1 ? "package" : "packages"}
                    </span>
                  </div>

                  <div className="worker-summary-stats">
                    <span>
                      {minPrice === maxPrice
                        ? peso.format(minPrice)
                        : `${peso.format(minPrice)} – ${peso.format(maxPrice)}`}
                    </span>
                  </div>
                </summary>

                <div className="worker-profile-body">
                  <div className="form-grid">
                    <label>
                      Service Category Name
                      <input
                        value={category.category}
                        onChange={(e) =>
                          updateCategory(category.id, {
                            category: e.target.value,
                          })
                        }
                        placeholder="Example: Premium Wash"
                      />
                    </label>

                    <label>
                      Commission Type
                      <select
                        value={category.commissionType}
                        onChange={(e) =>
                          updateCategory(category.id, {
                            commissionType: e.target.value,
                          })
                        }
                      >
                        <option>Washing</option>
                        <option>Detailing</option>
                        <option>Other</option>
                      </select>
                    </label>

                    <label>
                      Default Service Commission (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={category.commissionRate}
                        onChange={(e) =>
                          updateCategory(category.id, {
                            commissionRate:
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value),
                          })
                        }
                        placeholder="Example: 30"
                      />
                    </label>
                  </div>

                  <div className="price-item-list">
                    <strong>Packages / Sizes</strong>

                    <div className="price-item-row price-item-head">
                      <span>Package / Size Name</span>
                      <span>Price (₱)</span>
                      <span />
                    </div>

                    {category.items.map((item) => (
                      <div className="price-item-row" key={item.id}>
                        <input
                          value={item.size}
                          onChange={(e) =>
                            updateItem(category.id, item.id, {
                              size: e.target.value,
                            })
                          }
                          placeholder="Example: Medium"
                        />

                        <input
                          type="number"
                          min="0"
                          value={item.price}
                          onChange={(e) =>
                            updateItem(category.id, item.id, {
                              price:
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value),
                            })
                          }
                          placeholder="0"
                        />

                        <button
                          type="button"
                          className="small-danger-btn"
                          onClick={() => removeItem(category.id, item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      className="secondary-btn no-margin"
                      onClick={() => addItem(category.id)}
                    >
                      + Add Package / Size
                    </button>
                  </div>

                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => removeCategory(category.id)}
                  >
                    Delete Service Category
                  </button>
                </div>
              </details>
            );
          })
        )}
      </div>

      <div className="form-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Add-ons</span>
            <h2>Add-on Pricing</h2>
          </div>

          <button
            type="button"
            className="secondary-btn no-margin"
            onClick={addAddOn}
          >
            + Add Add-on
          </button>
        </div>

        <div className="price-item-list">
          {addOns.length === 0 ? (
            <p className="empty">No add-ons yet.</p>
          ) : (
            <>
              <div className="price-item-row price-item-head">
                <span>Add-on Name</span>
                <span>Price (₱)</span>
                <span />
              </div>

              {addOns.map((addOn) => (
                <div className="price-item-row" key={addOn.id}>
                  <input
                    value={addOn.name}
                    onChange={(e) =>
                      updateAddOn(addOn.id, { name: e.target.value })
                    }
                    placeholder="Example: Premium Shampoo"
                  />

                  <input
                    type="number"
                    min="0"
                    value={addOn.price}
                    onChange={(e) =>
                      updateAddOn(addOn.id, {
                        price:
                          e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                    placeholder="0"
                  />

                  <button
                    type="button"
                    className="small-danger-btn"
                    onClick={() => removeAddOn(addOn.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
